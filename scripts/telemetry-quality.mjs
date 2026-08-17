export function classifyReferenceQuality({
  referenceAvailable,
  officialTotal,
  referenceTotal,
  correctedPointCount,
  referenceMissingPointCount,
}) {
  if (!referenceAvailable) {
    return {
      exactMatch: false,
      officialMinusReference: null,
      status: "official range series published unchanged; optional npm-stat comparison unavailable",
    };
  }

  const exactMatch = correctedPointCount === 0 && referenceMissingPointCount === 0;
  return {
    exactMatch,
    officialMinusReference: officialTotal - referenceTotal,
    status: exactMatch
      ? "official range series matches the optional npm-stat comparison point for point"
      : "official range series published unchanged; optional npm-stat comparison differs",
  };
}

function nonnegativeInteger(value, label) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid download count for ${label}.`);
  return count;
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function summarizeOfficialRange(response, label = "official npm range") {
  if (!response || !Array.isArray(response.downloads)) throw new Error(`${label} is missing its daily download series.`);
  if (!response.downloads.length) throw new Error(`${label} contains no daily download points.`);
  const downloads = response.downloads.map((point, index) => {
    if (!point || !validIsoDate(point.day)) {
      throw new Error(`${label} contains an invalid date at position ${index}.`);
    }
    return { day: point.day, downloads: nonnegativeInteger(point.downloads, `${label} ${point.day}`) };
  });
  const start = response.start || downloads[0]?.day || null;
  const end = response.end || downloads.at(-1)?.day || null;
  if (!validIsoDate(start) || !validIsoDate(end) || start > end) throw new Error(`${label} has invalid range endpoints.`);
  if (downloads.length && (downloads[0].day !== start || downloads.at(-1).day !== end)) {
    throw new Error(`${label} endpoints do not match its daily series.`);
  }
  const expected = new Date(`${start}T00:00:00Z`);
  for (const point of downloads) {
    if (point.day !== expected.toISOString().slice(0, 10)) {
      throw new Error(`${label} is missing or misorders the official day ${expected.toISOString().slice(0, 10)}.`);
    }
    expected.setUTCDate(expected.getUTCDate() + 1);
  }
  const dayAfterEnd = new Date(`${end}T00:00:00Z`);
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
  if (expected.valueOf() !== dayAfterEnd.valueOf()) throw new Error(`${label} does not cover every day in its range.`);
  return {
    start,
    end,
    downloads,
    total: downloads.reduce((sum, point) => sum + point.downloads, 0),
  };
}

export function compareReferenceSeries({ officialDownloads, referencePoints }) {
  if (!Array.isArray(officialDownloads)) throw new Error("Official daily downloads must be an array.");
  const officialSeries = officialDownloads.map((point, index) => ({
    day: point.day,
    downloads: nonnegativeInteger(point.downloads, `official series point ${index}`),
  }));
  const officialTotal = officialSeries.reduce((sum, point) => sum + point.downloads, 0);
  const referenceAvailable = referencePoints !== null && referencePoints !== undefined;
  if (!referenceAvailable) {
    const quality = classifyReferenceQuality({ referenceAvailable, officialTotal });
    return {
      officialTotal,
      npmStatReferenceTotal: null,
      officialMinusNpmStat: quality.officialMinusReference,
      correctedPointCount: null,
      referenceMissingPointCount: null,
      referenceAvailable,
      exactMatch: quality.exactMatch,
      status: quality.status,
    };
  }

  try {
    let referenceTotal = 0;
    let correctedPointCount = 0;
    let referenceMissingPointCount = 0;
    for (const point of officialSeries) {
      if (!Object.hasOwn(referencePoints, point.day)) {
        referenceMissingPointCount += 1;
        continue;
      }
      const referenceCount = nonnegativeInteger(referencePoints[point.day], `optional npm-stat comparison ${point.day}`);
      referenceTotal += referenceCount;
      if (referenceCount !== point.downloads) correctedPointCount += 1;
    }
    const quality = classifyReferenceQuality({
      referenceAvailable,
      officialTotal,
      referenceTotal,
      correctedPointCount,
      referenceMissingPointCount,
    });
    return {
      officialTotal,
      npmStatReferenceTotal: referenceTotal,
      officialMinusNpmStat: quality.officialMinusReference,
      correctedPointCount,
      referenceMissingPointCount,
      referenceAvailable,
      exactMatch: quality.exactMatch,
      status: quality.status,
    };
  } catch {
    const quality = classifyReferenceQuality({ referenceAvailable: false, officialTotal });
    return {
      officialTotal,
      npmStatReferenceTotal: null,
      officialMinusNpmStat: null,
      correctedPointCount: null,
      referenceMissingPointCount: null,
      referenceAvailable: false,
      exactMatch: quality.exactMatch,
      status: quality.status,
    };
  }
}
