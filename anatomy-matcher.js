(function (global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    global.AnatomyMatcher = factory();
  }
}(this, (function () {
  'use strict';

  /**
   * Builds a deterministic anatomy matcher from the provided dictionary.
   * 
   * @param {Array} dictionary - The anatomy dictionary containing concepts and aliases.
   * @returns {Function} A matching function that takes a text string and returns an array of match objects.
   */
  function buildAnatomyMatcher(dictionary) {
    if (!Array.isArray(dictionary)) {
      throw new Error("Dictionary must be an array.");
    }

    const triggers = [];

    for (let i = 0; i < dictionary.length; i++) {
      const concept = dictionary[i];
      if (concept.status !== 'approved') continue;

      // Canonical term
      if (concept.term) {
        triggers.push({
          conceptId: concept.id,
          canonicalTerm: concept.term,
          triggerText: concept.term
        });
      }

      // Aliases
      if (Array.isArray(concept.aliases)) {
        for (let j = 0; j < concept.aliases.length; j++) {
          triggers.push({
            conceptId: concept.id,
            canonicalTerm: concept.term,
            triggerText: concept.aliases[j]
          });
        }
      }
    }

    // Precompile boundaries
    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i];
      // Escape regex specials
      let escaped = t.triggerText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      
      // Handle straight and curly apostrophes equivalently
      escaped = escaped.replace(/['\u2019]/g, "['\u2019]");

      // Strict word boundary ensures we don't match substrings inside other words
      t.regex = new RegExp('\\b' + escaped + '\\b', 'gi');
    }

    /**
     * Parses arbitrary text and returns non-overlapping anatomical matches.
     * 
     * @param {String} text - The input text (e.g. a KROK question).
     * @returns {Array} List of match objects.
     */
    return function matchAnatomy(text) {
      if (!text || typeof text !== 'string') return [];

      const allMatches = [];

      // 1. Discover valid candidate matches
      for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        t.regex.lastIndex = 0; // reset stateful regex
        let match;
        while ((match = t.regex.exec(text)) !== null) {
          allMatches.push({
            conceptId: t.conceptId,
            canonicalTerm: t.canonicalTerm,
            matchedText: match[0],
            start: match.index,
            end: match.index + match[0].length
          });
        }
      }

      if (allMatches.length === 0) return [];

      // 2. Overlap resolution: Sort to prioritize the best candidates
      // Primary: Longest match length descending
      // Secondary: Earlier start index ascending
      // Tertiary: Stable deterministic tie-breaker (conceptId ascending)
      allMatches.sort(function (a, b) {
        const lenA = a.end - a.start;
        const lenB = b.end - b.start;
        
        if (lenA !== lenB) {
          return lenB - lenA; // longer spans first
        }
        if (a.start !== b.start) {
          return a.start - b.start; // earlier start first
        }
        return a.conceptId.localeCompare(b.conceptId);
      });

      const accepted = [];

      // 3. Greedily accept matches that do not overlap with already accepted spans
      for (let i = 0; i < allMatches.length; i++) {
        const m = allMatches[i];
        let overlap = false;
        
        for (let j = 0; j < accepted.length; j++) {
          const acc = accepted[j];
          // Check for intersection: start1 < end2 && start2 < end1
          if (m.start < acc.end && acc.start < m.end) {
            overlap = true;
            break;
          }
        }
        
        if (!overlap) {
          accepted.push(m);
        }
      }

      // 4. Sort final results by textual position for output
      accepted.sort(function (a, b) {
        return a.start - b.start;
      });

      return accepted;
    };
  }

  return {
    buildAnatomyMatcher: buildAnatomyMatcher
  };
})));
