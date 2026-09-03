/**
 * @fileoverview Query Builder Engine for Natural Language Processing
 *
 * This module assembles Scryfall queries from extracted concept mappings,
 * applies optimization strategies, and generates explanations and alternatives.
 */

import {
  ParsedQuery,
  ConceptMapping,
  BuildOptions,
  BuildResult,
} from './types.js';
import { ConceptExtractor } from './concept-extractor.js';
import { ScryfallClient } from '../services/scryfall-client.js';
import { applyFormat, buildBaseQuery, formatQueryToken } from './query-builder/query-assembly.js';
import {
  applyOptimization,
  TestedQuery,
  testAndAdjustQuery,
} from './query-builder/query-optimization.js';
import {
  generateAlternatives,
  generateExplanation,
} from './query-builder/query-explanations.js';

/**
 * Builds optimized Scryfall queries from natural language concepts
 */
export class QueryBuilderEngine {
  constructor(
    private readonly conceptExtractor: ConceptExtractor,
    private readonly scryfallClient: ScryfallClient
  ) {}

  async build(parsed: ParsedQuery, options: BuildOptions): Promise<BuildResult> {
    const mappings = this.conceptExtractor.extractMappings(parsed);
    const buildConstrainedBaseQuery = (candidateMappings: ConceptMapping[]): string => {
      const query = buildBaseQuery(candidateMappings);
      return options.price_budget
        ? `${query} ${formatQueryToken(options.price_budget.currency, String(options.price_budget.max), '<=')}`.trim()
        : query;
    };
    const baseQuery = buildConstrainedBaseQuery(mappings);
    const formatQuery = applyFormat(baseQuery, options.format);
    const optimizedQuery = applyOptimization(formatQuery, options.optimize_for);
    const testedQuery = options.test_query
      ? await testAndAdjustQuery(this.scryfallClient, optimizedQuery, options)
      : { query: optimizedQuery, optimizations: [] };
    const explanation = generateExplanation(mappings, options);
    const alternatives = generateAlternatives(parsed, mappings, options, buildConstrainedBaseQuery);

    return {
      query: testedQuery.query,
      explanation,
      confidence: this.calculateBuildConfidence(parsed, mappings, testedQuery),
      alternatives,
      optimizations: testedQuery.optimizations,
      testSummary: testedQuery.testSummary,
    };
  }

  private calculateBuildConfidence(
    parsed: ParsedQuery,
    _mappings: ConceptMapping[],
    testedQuery: TestedQuery
  ): number {
    let confidence = parsed.confidence;

    if (testedQuery.optimizations.length === 0) {
      confidence += 0.1;
    }

    confidence -= testedQuery.optimizations.length * 0.05;

    return Math.max(0, Math.min(1, confidence));
  }
}
