function normalizeScientificFormatting(text, type) {
  let result = text;

  // ---------------------------------
  // TEMPERATURE_FORMAT
  // ---------------------------------

  if (type === "TEMPERATURE_FORMAT") {
    result = result
      .replace(
        /(\d+(?:[.,]\d+)?)\s*[oO]\s*C\b/g,
        "$1°C"
      )
      .replace(
        /(\d+(?:[.,]\d+)?)\s*°\s+C\b/g,
        "$1°C"
      );

    return result;
  }

  // ---------------------------------
  // GAS_NOTATION
  // ---------------------------------

  if (type === "GAS_NOTATION") {
    result = result.replace(
      /\b(O|CO|COO|HCO|SO|NO|NH)\s+([234])\b/g,
      "$1$2"
    );

    return result;
  }

  // ---------------------------------
  // SCIENTIFIC_NOTATION
  // Historical name: mainly OCR-split
  // chemical / ionic notation.
  // ---------------------------------

  if (type === "SCIENTIFIC_NOTATION") {
    // H C O 3 − -> HCO3−
    result = result.replace(
      /\bH\s+C\s+O\s+3\s*([+−-])/g,
      (_, charge) =>
        `HCO3${charge === "-" ? "−" : charge}`
    );

    // C a 2+ -> Ca2+
    // M g 2+ -> Mg2+
    result = result.replace(
      /\b(C\s+a|M\s+g)\s+2\s*\+/g,
      match => {
        const compact =
          match.replace(/\s+/g, "");

        return compact;
      }
    );

    // N a + -> Na+
    // K + -> K+
    result = result.replace(
      /\b(N\s+a|K)\s*\+/g,
      match =>
        match.replace(/\s+/g, "")
    );

    // C l − -> Cl−
    result = result.replace(
      /\bC\s+l\s*([−-])/g,
      (_, charge) =>
        `Cl${charge === "-" ? "−" : charge}`
    );

    // N a -> Na
    result = result.replace(
      /\bN\s+a\b/g,
      "Na"
    );

    // C a -> Ca
    result = result.replace(
      /\bC\s+a\b/g,
      "Ca"
    );

    return result;
  }

  return null;
}

module.exports = {
  normalizeScientificFormatting
};