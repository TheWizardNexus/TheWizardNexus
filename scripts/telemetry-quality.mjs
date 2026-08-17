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
      correction: null,
      status: "official series recorded; npm-stat reference unavailable",
    };
  }

  const exactMatch = correctedPointCount === 0 && referenceMissingPointCount === 0;
  return {
    exactMatch,
    correction: officialTotal - referenceTotal,
    status: exactMatch
      ? "official series matches npm-stat reference point for point"
      : "official series reconciles npm-stat reference",
  };
}
