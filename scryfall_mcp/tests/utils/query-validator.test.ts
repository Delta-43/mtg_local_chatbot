import { describe, it, expect } from "vitest";
import {
  validateScryfallQuery,
  validateScryfallQuerySync,
  validateScryfallQueryAsync,
} from "../../src/utils/query-validator.js";
import { validateScryfallQuery as validateScryfallQueryFromValidators } from "../../src/utils/validators.js";

describe("Simple Query Validator", () => {
  describe("Basic Validation", () => {
    it("should validate simple card name queries", () => {
      const result = validateScryfallQuery("lightning bolt");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("should validate basic operator queries", () => {
      const result = validateScryfallQuery("c:red");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate complex boolean queries", () => {
      const result = validateScryfallQuery("c:red AND t:creature");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate quoted string queries", () => {
      const result = validateScryfallQuery('o:"enters the battlefield"');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate comparison operators", () => {
      const result = validateScryfallQuery("cmc>=3");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate nested parentheses", () => {
      const result = validateScryfallQuery("(c:red OR c:blue) AND (t:creature OR t:instant)");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate multiple operators", () => {
      const result = validateScryfallQuery("c:red t:creature mv:3 set:dom");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Error Detection", () => {
    it("should detect empty queries", () => {
      const result = validateScryfallQuery("");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("empty");
      expect(result.errors[0].severity).toBe("error");
    });

    it("should detect whitespace-only queries", () => {
      const result = validateScryfallQuery("   ");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("empty");
    });

    it("should detect mismatched opening parentheses", () => {
      const result = validateScryfallQuery("(c:red AND t:creature");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("parentheses");
      expect(result.suggestions).toContain('Add closing parenthesis ")"');
    });

    it("should detect mismatched closing parentheses", () => {
      const result = validateScryfallQuery("c:red AND t:creature)");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("parentheses");
      expect(result.suggestions).toContain('Add opening parenthesis "("');
    });

    it("should detect unmatched quotes", () => {
      const result = validateScryfallQuery('o:"enters the battlefield');
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("quotes");
      expect(result.suggestions).toContain('Add closing quote "');
    });

    it("should detect multiple quote pairs with odd count", () => {
      const result = validateScryfallQuery('o:"first" AND o:"second');
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("quotes");
    });
  });

  describe("Warning Detection", () => {
    it("should warn about unknown operators", () => {
      const result = validateScryfallQuery("unknown:value");
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("Unknown operator");
      expect(result.warnings[0].severity).toBe("warning");
    });

    it("should suggest similar operators for typos", () => {
      const result = validateScryfallQuery("colr:red");
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions![0]).toContain("color");
    });

    it("should warn about && usage", () => {
      const result = validateScryfallQuery("c:red && t:creature");
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("AND");
      expect(result.suggestions).toContain('Replace "&&" with "AND"');
    });

    it("should warn about || usage", () => {
      const result = validateScryfallQuery("c:red || c:blue");
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("OR");
      expect(result.suggestions).toContain('Replace "||" with "OR"');
    });

    it("should warn about empty operator values", () => {
      const result = validateScryfallQuery('c:""');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("Empty operator value");
    });

    it("should warn about very long queries", () => {
      const longQuery = "c:red ".repeat(100); // Creates a 600+ character query
      const result = validateScryfallQuery(longQuery);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("Very long query");
    });
  });

  describe("Known Operators", () => {
    const knownOperators = [
      "c",
      "color",
      "id",
      "identity",
      "m",
      "mana",
      "mv",
      "manavalue",
      "cmc",
      "name",
      "n",
      "oracle",
      "o",
      "type",
      "t",
      "power",
      "pow",
      "toughness",
      "tou",
      "set",
      "s",
      "rarity",
      "r",
      "format",
      "f",
      "is",
      "not",
      "usd",
    ];

    knownOperators.forEach((operator) => {
      it(`should recognize ${operator} as a valid operator`, () => {
        const result = validateScryfallQuery(`${operator}:test`);
        expect(result.isValid).toBe(true);
        expect(result.warnings).toHaveLength(0);
      });
    });
  });

  describe("Async Validation", () => {
    it("should provide async validation", async () => {
      const result = await validateScryfallQueryAsync("c:red");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle async errors", async () => {
      const result = await validateScryfallQueryAsync("");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it("uses the same implementation in validators.ts for search_cards integration", async () => {
      const query = 'o:"draw a card" c:blue usd<=5';
      const directResult = validateScryfallQuery(query);
      const validatorsResult = await validateScryfallQueryFromValidators(query);

      expect(validatorsResult).toEqual(directResult);
      expect(validatorsResult).toHaveProperty("isValid");
      expect(validatorsResult).toHaveProperty("errors");
      expect(validatorsResult).toHaveProperty("warnings");
      expect(validatorsResult).toHaveProperty("suggestions");
    });
  });

  describe("Sync Validation", () => {
    it("should provide sync validation", () => {
      const result = validateScryfallQuerySync("c:red");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle sync errors", () => {
      const result = validateScryfallQuerySync("");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle queries with only spaces and operators", () => {
      const result = validateScryfallQuery("   c:red   ");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle complex nested structures", () => {
      const result = validateScryfallQuery(
        "((c:red OR c:blue) AND t:creature) OR (c:green AND t:instant)"
      );
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle multiple unknown operators", () => {
      const result = validateScryfallQuery("xyz:value abc:value");
      expect(result.isValid).toBe(true);
      // Should detect at least one unknown operator
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.message.includes("Unknown operator"))).toBe(true);
    });

    it("should handle mixed valid and invalid syntax", () => {
      const result = validateScryfallQuery("c:red AND (t:creature");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
