function recoverReplacementToken(
  sourceText,
  detected,
  proposedText
) {
  const index = sourceText.indexOf(detected);

  if (index === -1) {
    return null;
  }

  const prefix = sourceText.slice(0, index);
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

function applyBrokenWordCorrection(
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
      error: "Missing broken-word token"
    };
  }

  const sourceOccurrences =
    sourceText.split(detected).length - 1;

  if (sourceOccurrences !== 1) {
    return {
      ok: false,
      error:
        `Broken-word token "${detected}" occurs ${sourceOccurrences} times in source`
    };
  }

  const replacement =
    recoverReplacementToken(
      sourceText,
      detected,
      correction.proposed
    );

  if (!replacement) {
    return {
      ok: false,
      error:
        "Unable to recover broken-word reconstruction from proposal"
    };
  }

  const expectedProposal =
    sourceText.replace(
      detected,
      replacement
    );

  if (
    expectedProposal !==
    correction.proposed
  ) {
    return {
      ok: false,
      error:
        "Invalid broken-word proposal"
    };
  }

  const currentOccurrences =
    workingText.split(detected).length - 1;

  if (currentOccurrences !== 1) {
    return {
      ok: false,
      error:
        `Broken-word token "${detected}" does not occur exactly once in working text`
    };
  }

  return {
    ok: true,
    text: workingText.replace(
      detected,
      replacement
    )
  };
}

module.exports = {
  applyBrokenWordCorrection
};