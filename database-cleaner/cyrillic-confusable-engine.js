function getNormalizedToken(
  sourceText,
  detected,
  proposedText
) {
  const index = sourceText.indexOf(detected);

  if (index === -1) {
    return null;
  }

  const prefix = sourceText.slice(
    0,
    index
  );

  const suffix = sourceText.slice(
    index + detected.length
  );

  if (
    !proposedText.startsWith(prefix) ||
    !proposedText.endsWith(suffix)
  ) {
    return null;
  }

  return proposedText.slice(
    prefix.length,
    proposedText.length - suffix.length
  );
}

function applyCyrillicConfusable(
  sourceText,
  workingText,
  correction
) {
  const detected = String(
    correction.detected || ""
  );

  if (!detected) {
    return {
      ok: false,
      error: "Missing detected Cyrillic token"
    };
  }

  const sourceOccurrences =
    sourceText.split(detected).length - 1;

  if (sourceOccurrences !== 1) {
    return {
      ok: false,
      error:
        `Detected token "${detected}" occurs ${sourceOccurrences} times in source`
    };
  }

  const normalizedToken =
    getNormalizedToken(
      sourceText,
      detected,
      correction.proposed
    );

  if (!normalizedToken) {
    return {
      ok: false,
      error:
        "Unable to recover normalized Latin token from proposal"
    };
  }

  const expectedProposal =
    sourceText.replace(
      detected,
      normalizedToken
    );

  if (
    expectedProposal !==
    correction.proposed
  ) {
    return {
      ok: false,
      error:
        "Invalid Cyrillic-confusable proposal"
    };
  }

  const currentOccurrences =
    workingText.split(detected).length - 1;

  if (currentOccurrences !== 1) {
    return {
      ok: false,
      error:
        `Detected token "${detected}" does not occur exactly once in working text`
    };
  }

  return {
    ok: true,
    text: workingText.replace(
      detected,
      normalizedToken
    )
  };
}

module.exports = {
  applyCyrillicConfusable
};