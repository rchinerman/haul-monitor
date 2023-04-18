import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "react-query";

import "./styles.css";

const fetchLatestPatchVersion = async () => {
  const response = await fetch(
    "https://ddragon.leagueoflegends.com/api/versions.json"
  );
  const data = await response.json();
  return data[0];
};

const fetchChampionData = async (latestPatchVersion) => {
  const response = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${latestPatchVersion}/data/en_US/champion.json`
  );
  const { data } = await response.json();
  return data;
};

const encodeDraft = (draftedChampions, draftName) => {
  const keys = draftedChampions.map((champion) => champion.key);
  const data = { keys, draftName };
  return btoa(JSON.stringify(data));
};

const decodeDraft = (encodedDraft, championData) => {
  const jsonString = atob(encodedDraft);
  const decodedData = JSON.parse(jsonString);
  const decodedChampions = decodedData.keys.map((key) =>
    Object.values(championData).find((champion) => champion.key === key)
  );

  return {
    draftedChampions: decodedChampions,
    draftName: decodedData.draftName
  };
};

const getTagChampions = (champions) =>
  ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"].reduce(
    (tagChampions, tag) => {
      tagChampions[tag] = champions.filter((champion) =>
        champion.tags.includes(tag)
      );
      return tagChampions;
    },
    {}
  );

const getChampionsWithKey = (championData) =>
  Object.values(championData).map((champ) => champ);

const copyContent = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error("wtf", err);
  }
};

const TagInput = memo(
  ({ championData, tag, tagCount, scaledTagCounts, updateTagCountTotal }) => (
    <div className="label-input-wrapper">
      <label htmlFor={`tagCount-${tag}`}>
        {tag} ({tagCount[tag]} total):
      </label>
      <input
        id={`tagCount-${tag}`}
        type="number"
        min="0"
        max={championData?.length}
        value={scaledTagCounts?.[tag]}
        onChange={(event) =>
          updateTagCountTotal(event?.target?.value || 0, tag)
        }
      />
    </div>
  )
);

const ChampionCard = ({ champion, latestPatchVersion }) => (
  <a
    href={`https://u.gg/lol/champions/aram/${champion.id}-aram`}
    target="_blank"
    rel="noopener noreferrer"
  >
    <figure className="champion-card">
      <div
        className="champion-splash"
        style={{
          backgroundImage: `url(https://ddragon.leagueoflegends.com/cdn/${latestPatchVersion}/img/champion/${champion.image.full})`
        }}
        aria-label={`${champion.name} splash art`}
      >
        <div className="champion-overlay" />
      </div>
      <figcaption className="champion-info">
        <h3>{champion.name}</h3>
        <p>{champion.tags.join(", ")}</p>
      </figcaption>
    </figure>
  </a>
);

export default function App() {
  const [championPoolSize, setChampionPoolSize] = useState(0);
  const [tagCount, setTagCount] = useState({});
  const [champions, setChampions] = useState([]);
  const [scaledTagCounts, setScaledTagCounts] = useState({});
  const [draftedChampions, setDraftedChampions] = useState([]);
  const [draftName, setDraftName] = useState("");

  const location = useLocation();

  const { data: latestPatchVersion, isLoading: isPatchLoading } = useQuery(
    "latestPatchVersion",
    fetchLatestPatchVersion,
    {
      cacheTime: 60 * 60 * 1000 // one hour
    }
  );
  const { data: championData, isLoading: isChampionLoading } = useQuery(
    ["championData", latestPatchVersion],
    () => fetchChampionData(latestPatchVersion),
    {
      enabled: !!latestPatchVersion,
      cacheTime: 14 * 24 * 60 * 60 * 1000 // two weeks
    }
  );

  const adjustTagCounts = (
    preliminaryCounts,
    adjustments,
    adjustmentAmount
  ) => {
    return adjustments
      .slice(0, Math.abs(adjustmentAmount))
      .reduce((updatedCounts, [tag]) => {
        const updatedTagCount =
          adjustmentAmount > 0
            ? updatedCounts[tag] + 1
            : updatedCounts[tag] - 1;

        return { ...updatedCounts, [tag]: updatedTagCount };
      }, preliminaryCounts);
  };

  const updateScaledTagCounts = useCallback((poolSize, tagCounts) => {
    const totalTags = Object.values(tagCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    const tagWeights = Object.fromEntries(
      Object.entries(tagCounts).map(([tag, count]) => [tag, count / totalTags])
    );

    const sortedTags = Object.keys(tagWeights);

    const scale = poolSize / totalTags;

    const preliminaryTagCounts = Object.fromEntries(
      sortedTags.map((tag) => [tag, Math.round(tagCounts[tag] * scale)])
    );

    const preliminaryTagAdjustments = sortedTags.map((tag) => {
      const scaledTagCount = tagCounts[tag] * scale;
      return [
        tag,
        scaledTagCount > Math.round(scaledTagCount)
          ? scaledTagCount - Math.floor(scaledTagCount)
          : scaledTagCount - Math.ceil(scaledTagCount)
      ];
    });

    const preliminaryTotalTags = Object.values(preliminaryTagCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    const adjustment = poolSize - preliminaryTotalTags;

    const sortedAdjustments =
      adjustment > 0
        ? preliminaryTagAdjustments.sort((a, b) => b[1] - a[1])
        : preliminaryTagAdjustments.sort((a, b) => a[1] - b[1]);

    const updatedTagCounts = adjustTagCounts(
      preliminaryTagCounts,
      sortedAdjustments,
      adjustment
    );

    return updatedTagCounts;
  }, []);

  const draftChampionsNoTagRestrictions = (champions) => {
    const availableChampions = [...champions];

    const selectedChampions = Array.from({ length: championPoolSize }, () => {
      const randomIndex = Math.floor(Math.random() * availableChampions.length);
      const [champion] = availableChampions.splice(randomIndex, 1);
      return champion;
    });

    setDraftedChampions(
      selectedChampions.sort((a, b) => a.name.localeCompare(b.name))
    );
  };

  const draftChampions = (champions) => {
    const tagChampions = getTagChampions(champions);

    const draftedSet = new Set();

    const draftedChamps = Object.entries(scaledTagCounts).reduce(
      (drafted, [tag, count]) => {
        const availableChampions = tagChampions[tag].filter(
          (champ) => !draftedSet.has(champ.key)
        );

        const champs = Array.from({ length: count }, () => {
          const randomIndex = Math.floor(
            Math.random() * availableChampions.length
          );
          const [champion] = availableChampions.splice(randomIndex, 1);
          draftedSet.add(champion.key);
          return champion;
        });

        return [...drafted, ...champs];
      },
      []
    );

    setDraftedChampions(
      draftedChamps.sort((a, b) => a.name.localeCompare(b.name))
    );
  };

  function countTags(champions) {
    return champions.reduce((tagCounts, champion) => {
      return champion.tags
        ? champion.tags.reduce((acc, tag) => {
            return { ...acc, [tag]: (acc[tag] || 0) + 1 };
          }, tagCounts)
        : tagCounts;
    }, {});
  }

  const updateTagCountTotal = (value, tag) => {
    const updatedTagCounts = {
      ...scaledTagCounts,
      [tag]: parseInt(value, 10)
    };
    setScaledTagCounts(updatedTagCounts);
    setChampionPoolSize(
      Object.values(updatedTagCounts).reduce((sum, count) => sum + count, 0)
    );
  };

  const updateTotalCount = (value) => {
    const newSize = parseInt(value, 10);
    const newScaledTagCounts = updateScaledTagCounts(newSize, tagCount);
    setScaledTagCounts(newScaledTagCounts);
    setChampionPoolSize(newSize);
  };

  const setInitialInputValues = useRef((draftedChampions, allChampions) => {
    const tagCounts = countTags(allChampions);
    setTagCount(tagCounts);
    const initialChampionPoolSize = draftedChampions?.length || 15;
    setChampionPoolSize(initialChampionPoolSize);
    const initialScaledTagCounts = updateScaledTagCounts(
      initialChampionPoolSize,
      tagCounts
    );
    if (Object.keys(scaledTagCounts).length === 0)
      setScaledTagCounts(initialScaledTagCounts);
  }).current;

  useEffect(() => {
    if (!championData) return;

    const searchParams = new URLSearchParams(location.search);
    const encodedDraft = searchParams.get("data");
    const allChampions = getChampionsWithKey(championData);
    setChampions(allChampions);
    if (
      encodedDraft &&
      championData &&
      Object.keys(championData).length !== 0
    ) {
      try {
        const { draftedChampions, draftName } = decodeDraft(
          encodedDraft,
          championData
        );
        setDraftedChampions(draftedChampions);
        setDraftName(draftName);
        setInitialInputValues(draftedChampions, allChampions);
      } catch (err) {
        console.error("Error decoding draft:", err);
      }
    } else {
      setInitialInputValues(null, allChampions);
    }
  }, [championData, setInitialInputValues, location.search]);

  const handleCopyDraftUrl = async () => {
    const encodeedData = encodeDraft(draftedChampions, draftName);
    const url = `${window.location.origin}${window.location.pathname}?data=${encodeedData}`;
    await copyContent(url);
  };

  if (isChampionLoading || isPatchLoading) return;

  return (
    <main>
      <div className="container">
        <section>
          <label htmlFor="draftName">Draft Name: </label>
          <input
            id="draftName"
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
          />
        </section>
        <section>
          <h2>Class Restrictions</h2>
          <form>
            {Object.keys(tagCount).map((tag) => (
              <TagInput
                key={tag}
                championData={championData}
                tag={tag}
                tagCount={tagCount}
                scaledTagCounts={scaledTagCounts}
                updateTagCountTotal={updateTagCountTotal}
              />
            ))}
            <fieldset>
              <label htmlFor="championPoolSize">Total champions: </label>
              <input
                id="championPoolSize"
                type="number"
                min="0"
                max={championData?.length}
                value={championPoolSize}
                onChange={(event) => updateTotalCount(event.target.value)}
              />
            </fieldset>
          </form>
        </section>
        <section>
          <h2>Draft Options</h2>
          <div className="draft-options">
            <button
              onClick={() => draftChampions(champions)}
              aria-label="Draft with tag restrictions"
            >
              Draft With Class Restrictions
            </button>
            <button
              onClick={() => draftChampionsNoTagRestrictions(champions)}
              aria-label="Draft without tag restrictions"
            >
              Draft Without Class Restrictions
            </button>
            <button
              onClick={() =>
                copyContent(
                  draftedChampions.map((champion) => champion.name).join(", ")
                )
              }
            >
              Copy Draft
            </button>
            <button onClick={handleCopyDraftUrl}>Copy Draft URL</button>
          </div>
        </section>
        <section>
          <h2>Drafted Champions ({draftedChampions.length} total)</h2>
          <div className="champion-grid">
            {draftedChampions.map((champion) => (
              <ChampionCard
                key={champion.key}
                champion={champion}
                latestPatchVersion={latestPatchVersion}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
