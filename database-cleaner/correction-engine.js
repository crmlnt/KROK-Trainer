function fail(message) {
  return {
    ok: false,
    error: message
  };
}

function success(text) {
  return {
    ok: true,
    text
  };
}

function countOccurrences(text, token) {
  if (!token) {
    return 0;
  }

  return text.split(token).length - 1;
}

// ---------------------------------
// Lexical replacement helper
// ---------------------------------

function recoverReplacementToken(
  sourceText,
  token,
  proposed
) {
  const index = sourceText.indexOf(token);

  if (index === -1) {
    return null;
  }

  const prefix = sourceText.slice(
    0,
    index
  );

  const suffix = sourceText.slice(
    index + token.length
  );

  if (
    !proposed.startsWith(prefix) ||
    !proposed.endsWith(suffix)
  ) {
    return null;
  }

  return proposed.slice(
    prefix.length,
    proposed.length - suffix.length
  );
}

// ---------------------------------
// Main correction engine
// ---------------------------------

function applyCorrectionToText(
  sourceText,
  workingText,
  correction
) {
  const type = String(
    correction.type || ""
  );

  // =================================
  // B12_SPACING
  // =================================

  if (type === "B12_SPACING") {
    const expectedProposal =
      sourceText.replace(
        /\bB\s+12\b/g,
        "B12"
      );

    if (
      correction.proposed !==
      expectedProposal
    ) {
      return fail(
        "Invalid B12 proposal"
      );
    }

    const after =
      workingText.replace(
        /\bB\s+12\b/g,
        "B12"
      );

    if (after === workingText) {
      return fail(
        "No B12 spacing pattern remains"
      );
    }

    return success(after);
  }

  // =================================
  // BROKEN_WORD_HYPHENATION
  // =================================

  if (
    type ===
    "BROKEN_WORD_HYPHENATION"
  ) {
    const token = String(
      correction.detected || ""
    );

    if (!token) {
      return fail(
        "Missing hyphenation token"
      );
    }

    if (
      countOccurrences(
        sourceText,
        token
      ) !== 1
    ) {
      return fail(
        `Hyphenation token "${token}" does not occur exactly once in source`
      );
    }

    const correctedToken =
      token.replace("-", "");

    const expectedProposal =
      sourceText.replace(
        token,
        correctedToken
      );

    if (
      correction.proposed !==
      expectedProposal
    ) {
      return fail(
        "Invalid hyphenation proposal"
      );
    }

    if (
      countOccurrences(
        workingText,
        token
      ) !== 1
    ) {
      return fail(
        `Hyphenation token "${token}" does not occur exactly once in working text`
      );
    }

    return success(
      workingText.replace(
        token,
        correctedToken
      )
    );
  }

  // =================================
  // SPACE_BEFORE_PUNCTUATION
  // =================================

  if (
    type ===
    "SPACE_BEFORE_PUNCTUATION"
  ) {
    const expectedProposal =
      sourceText.replace(
        /\s+([,.!?;:])/g,
        "$1"
      );

    if (
      correction.proposed !==
      expectedProposal
    ) {
      return fail(
        "Invalid space-before-punctuation proposal"
      );
    }

    const after =
      workingText.replace(
        /\s+([,.!?;:])/g,
        "$1"
      );

    if (after === workingText) {
      return fail(
        "No space-before-punctuation pattern remains"
      );
    }

    return success(after);
  }

  // =================================
  // MISSING_SPACE_AFTER_PUNCTUATION
  // =================================

  if (
    type ===
    "MISSING_SPACE_AFTER_PUNCTUATION"
  ) {
    const expectedProposal =
      sourceText
        .replace(
          /([!?;:])([A-Za-z])/g,
          "$1 $2"
        )
        .replace(
          /\.([A-Z])/g,
          ". $1"
        );

    if (
      correction.proposed !==
      expectedProposal
    ) {
      return fail(
        "Invalid missing-space-after-punctuation proposal"
      );
    }

    const after =
      workingText
        .replace(
          /([!?;:])([A-Za-z])/g,
          "$1 $2"
        )
        .replace(
          /\.([A-Z])/g,
          ". $1"
        );

    if (after === workingText) {
      return fail(
        "No missing-space pattern remains"
      );
    }

    return success(after);
  }

  // =================================
  // OCR_CASE_CORRUPTION
  // =================================

  if (
    type ===
    "OCR_CASE_CORRUPTION"
  ) {
    const token = String(
      correction.detected || ""
    );

    if (!token) {
      return fail(
        "Missing OCR token"
      );
    }

    if (!token.includes("FI")) {
      return fail(
        "OCR token does not contain FI"
      );
    }

    if (
      countOccurrences(
        sourceText,
        token
      ) !== 1
    ) {
      return fail(
        `OCR token "${token}" does not occur exactly once in source`
      );
    }

    const correctedToken =
      token.replace(
        /FI/g,
        "fi"
      );

    const expectedProposal =
      sourceText.replace(
        token,
        correctedToken
      );

    if (
      correction.proposed !==
      expectedProposal
    ) {
      return fail(
        "Invalid OCR case proposal"
      );
    }

    if (
      expectedProposal.length !==
      sourceText.length
    ) {
      return fail(
        "OCR correction changes text length"
      );
    }

    if (
      countOccurrences(
        workingText,
        token
      ) !== 1
    ) {
      return fail(
        `OCR token "${token}" does not occur exactly once in working text`
      );
    }

    return success(
      workingText.replace(
        token,
        correctedToken
      )
    );
  }

  // =================================
  // KNOWN_LEXICAL_TYPO
  // =================================

  if (
    type ===
    "KNOWN_LEXICAL_TYPO"
  ) {
    const token = String(
      correction.detected || ""
    );

    if (!token) {
      return fail(
        "Missing lexical typo token"
      );
    }

    if (
      countOccurrences(
        sourceText,
        token
      ) !== 1
    ) {
      return fail(
        `Lexical token "${token}" does not occur exactly once in source`
      );
    }

    const replacementToken =
      recoverReplacementToken(
        sourceText,
        token,
        correction.proposed
      );

    if (!replacementToken) {
      return fail(
        "Invalid lexical typo proposal structure"
      );
    }

    const expectedProposal =
      sourceText.replace(
        token,
        replacementToken
      );

    if (
      correction.proposed !==
      expectedProposal
    ) {
      return fail(
        "Invalid lexical typo proposal"
      );
    }

    if (
      countOccurrences(
        workingText,
        token
      ) !== 1
    ) {
      return fail(
        `Lexical token "${token}" does not occur exactly once in working text`
      );
    }

    return success(
      workingText.replace(
        token,
        replacementToken
      )
    );
  }

  // =================================
  // Unsupported
  // =================================

  return fail(
    `Unsupported correction type "${type}"`
  );
}

module.exports = {
  applyCorrectionToText
};