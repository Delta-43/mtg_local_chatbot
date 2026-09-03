/**
 * @fileoverview Build Scryfall Query Tool
 * 
 * This MCP tool converts natural language requests into optimized Scryfall
 * search queries with explanations and alternatives.
 */

import { ScryfallClient } from '../services/scryfall-client.js';
import { NaturalLanguageParser } from '../natural-language/parser.js';
import { QueryBuilderEngine } from '../natural-language/query-builder.js';
import { ConceptExtractor } from '../natural-language/concept-extractor.js';
import { validateBuildQueryParams } from '../utils/validators.js';
import { 
  ValidationError, 
  ScryfallAPIError,
  BuildQueryParams
} from '../types/mcp-types.js';
import { 
  ParsedQuery, 
  BuildResult 
} from '../natural-language/types.js';

/**
 * MCP Tool for converting natural language to Scryfall queries
 */
export class BuildScryfallQueryTool {
  readonly name = 'build_scryfall_query';
  readonly description = 'Convert natural language requests into optimized Scryfall search queries with explanations and alternatives';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      natural_query: {
        type: 'string',
        description: 'Natural language description of what you want to find (e.g., "red creatures under $5 for aggressive decks", "blue counterspells in modern")',
        minLength: 1,
        maxLength: 500
      },
      format: {
        type: 'string',
        enum: ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer', 'brawl', 'pauper', 'penny', 'historic', 'alchemy'],
        description: 'Magic format to restrict search to (optional)'
      },
      optimize_for: {
        type: 'string',
        enum: ['precision', 'recall', 'discovery', 'budget'],
        default: 'precision',
        description: 'Search optimization strategy: precision (fewer, more relevant results), recall (broader search), discovery (interesting cards), budget (cost-effective)'
      },
      max_results: {
        type: 'number',
        minimum: 1,
        maximum: 175,
        default: 20,
        description: 'Target number of results for optimization'
      },
      price_budget: {
        type: 'object',
        properties: {
          max: {
            type: 'number',
            minimum: 0,
            description: 'Maximum price per card'
          },
          currency: {
            type: 'string',
            enum: ['usd', 'eur', 'tix'],
            default: 'usd',
            description: 'Currency for price constraints'
          }
        },
        required: ['max'],
        description: 'Price constraints for the search'
      },
      include_alternatives: {
        type: 'boolean',
        default: true,
        description: 'Whether to include alternative query suggestions'
      },
      explain_mapping: {
        type: 'boolean',
        default: true,
        description: 'Whether to include detailed explanation of natural language to Scryfall mapping'
      },
      test_query: {
        type: 'boolean',
        default: false,
        description: 'Whether to test the generated query and optimize based on results'
      }
    },
    required: ['natural_query']
  };

  constructor(
    private readonly scryfallClient: ScryfallClient,
    private readonly parser = new NaturalLanguageParser(),
    private readonly conceptExtractor = new ConceptExtractor(),
    private readonly queryBuilder = new QueryBuilderEngine(new ConceptExtractor(), scryfallClient)
  ) {}

  async execute(args: unknown) {
    try {
      // Validate input parameters
      const params = validateBuildQueryParams(args);
      
      // Sanitize natural language input (using a more permissive approach for natural language)
      const sanitizedQuery = params.natural_query.trim()
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
        .substring(0, 500); // Enforce max length
      
      if (!sanitizedQuery) {
        throw new ValidationError('Natural query cannot be empty after sanitization');
      }
      
      // Parse natural language
      const parsed = this.parser.parse(sanitizedQuery, {
        targetFormat: params.format,
        optimizationStrategy: params.optimize_for,
        maxResults: params.max_results
      });
      
      // Check parsing confidence
      if (parsed.confidence < 0.3) {
        return this.handleLowConfidenceParsing(parsed, params);
      }
      
      // Build Scryfall query
      const buildOptions = {
        optimize_for: params.optimize_for,
        format: params.format,
        max_results: params.max_results,
        price_budget: params.price_budget,
        test_query: params.test_query,
      };
      
      const buildResult = await this.queryBuilder.build(parsed, buildOptions);
      const testResult = params.test_query ? (buildResult.testSummary ?? null) : null;
      
      // Format response
      const responseText = this.formatResponse(
        buildResult,
        testResult,
        params,
        parsed
      );
      
      return {
        content: [{
          type: 'text',
          text: responseText
        }]
      };

    } catch (error) {
      return this.handleError(error);
    }
  }
  
  /**
   * Format the complete response
   */
  private formatResponse(
    buildResult: BuildResult,
    testResult: BuildResult["testSummary"] | null,
    params: BuildQueryParams,
    parsed: ParsedQuery
  ): string {
    let response = `**Generated Scryfall Query:**\n\`${buildResult.query}\`\n\n`;
    
    // Add test results
    if (testResult) {
      response += `**Query Test Results:**\n`;
      const totalCards = testResult.total_cards;
      response += `✅ Query is valid and returns ${totalCards} cards\n`;
      
      if (totalCards === 0) {
        response += `⚠️ No results found. Consider broadening your search.\n`;
      } else if (totalCards > params.max_results * 5) {
        response += `⚠️ Many results (${totalCards}). Consider adding more constraints.\n`;
      } else {
        response += `✨ Good result count for exploration.\n`;
      }
      response += '\n';
    }
    
    // Add explanation if requested
    if (params.explain_mapping) {
      response += `**Explanation:**\n${buildResult.explanation}\n\n`;
      
      response += `**Natural Language Mapping:**\n`;
      response += this.formatConceptMapping(parsed);
      response += '\n';
    }
    
    // Add confidence information
    response += `**Confidence Scores:**\n`;
    response += `• Parsing Confidence: ${(parsed.confidence * 100).toFixed(0)}%\n`;
    response += `• Query Build Confidence: ${(buildResult.confidence * 100).toFixed(0)}%\n`;
    
    if (parsed.ambiguities && parsed.ambiguities.length > 0) {
      response += `• Detected Ambiguities: ${parsed.ambiguities.length}\n`;
    }
    response += '\n';
    
    // Add optimizations applied
    if (buildResult.optimizations.length > 0) {
      response += `**Optimizations Applied:**\n`;
      for (const opt of buildResult.optimizations) {
        response += `• ${opt.type}: ${opt.reason}\n`;
      }
      response += '\n';
    }
    
    // Add alternatives if requested
    if (params.include_alternatives && buildResult.alternatives.length > 0) {
      response += `**Alternative Queries:**\n`;
      for (const alt of buildResult.alternatives) {
        response += `• \`${alt.query}\` - ${alt.description}\n`;
      }
      response += '\n';
    }
    
    // Add usage instructions
    response += `**Usage:**\n`;
    response += `You can now use this query with the \`search_cards\` tool:\n`;
    response += `\`\`\`json\n`;
    response += `{\n`;
    response += `  "tool": "search_cards",\n`;
    response += `  "arguments": {\n`;
    response += `    "query": "${buildResult.query}",\n`;
    response += `    "limit": ${params.max_results}\n`;
    response += `  }\n`;
    response += `}\n`;
    response += `\`\`\`\n`;
    
    return response;
  }
  
  /**
   * Format concept mapping for display
   */
  private formatConceptMapping(parsed: ParsedQuery): string {
    const mappings: string[] = [];
    
    if (parsed.colors.length > 0) {
      const colorDescs = parsed.colors.map(c => {
        const colorNames = c.colors.map(color => this.getColorName(color)).join(', ');
        const type = c.exact ? 'exactly' : c.inclusive ? 'including' : 'any';
        return `${type} ${colorNames}`;
      });
      mappings.push(`• Colors: ${colorDescs.join('; ')}`);
    }
    
    if (parsed.types.length > 0) {
      const types = parsed.types.map(t => t.type || t.supertype).join(', ');
      mappings.push(`• Types: ${types}`);
    }
    
    if (parsed.archetypes.length > 0) {
      const archetypes = parsed.archetypes.map(a => a.name).join(', ');
      mappings.push(`• Archetypes: ${archetypes}`);
    }
    
    if (parsed.priceConstraints.length > 0) {
      const prices = parsed.priceConstraints.map(p => {
        if (p.max !== undefined && p.min !== undefined) {
          return `${p.min}-${p.max} ${p.currency.toUpperCase()}`;
        } else if (p.max !== undefined) {
          return `under ${p.max} ${p.currency.toUpperCase()}`;
        } else if (p.min !== undefined) {
          return `over ${p.min} ${p.currency.toUpperCase()}`;
        }
        return '';
      }).filter(p => p);
      mappings.push(`• Price: ${prices.join(', ')}`);
    }
    
    if (parsed.formats.length > 0) {
      const formats = parsed.formats.map(f => f.name).join(', ');
      mappings.push(`• Formats: ${formats}`);
    }
    
    return mappings.join('\n');
  }
  
  /**
   * Get color name from single letter code
   */
  private getColorName(code: string): string {
    const colorMap = new Map([
      ['w', 'white'], ['u', 'blue'], ['b', 'black'], 
      ['r', 'red'], ['g', 'green'], ['c', 'colorless']
    ]);
    
    return colorMap.get(code) || code;
  }
  
  /**
   * Handle low confidence parsing
   */
  private handleLowConfidenceParsing(parsed: ParsedQuery, params: BuildQueryParams) {
    let response = `**⚠️ Low Confidence Parsing**\n\n`;
    response += `I had difficulty understanding your natural language query "${params.natural_query}".\n\n`;
    response += `**What I understood:**\n`;
    response += this.formatConceptMapping(parsed);
    response += '\n\n';
    
    if (parsed.ambiguities.length > 0) {
      response += `**Ambiguities detected:**\n`;
      for (const ambiguity of parsed.ambiguities) {
        response += `• ${ambiguity.description}\n`;
      }
      response += '\n';
    }
    
    response += `**Suggestions:**\n`;
    response += `• Try using more specific terms (e.g., "red creatures" instead of "red cards")\n`;
    response += `• Include format information (e.g., "in modern" or "for commander")\n`;
    response += `• Be more explicit about constraints (e.g., "under $10" or "with power 3 or greater")\n`;
    response += `• Use Magic terminology (e.g., "instant", "sorcery", "planeswalker")\n\n`;
    
    response += `**Examples of well-understood queries:**\n`;
    response += `• "red aggressive creatures under $5 for modern"\n`;
    response += `• "blue counterspells in standard format"\n`;
    response += `• "legendary artifacts that produce mana for commander"\n`;
    response += `• "white removal spells under $10"\n`;
    
    return {
      content: [{
        type: 'text',
        text: response
      }]
    };
  }
  
  /**
   * Handle errors during execution
   */
  private handleError(error: unknown) {
    if (error instanceof ValidationError) {
      return {
        content: [{
          type: 'text',
          text: `**Validation Error:**\n${error.message}\n\nPlease check your parameters and try again.`
        }],
        isError: true
      };
    }
    
    if (error instanceof ScryfallAPIError) {
      return {
        content: [{
          type: 'text',
          text: `**Scryfall API Error:**\n${error.message}\n\nThe query generation succeeded, but testing failed. The generated query may still be valid.`
        }],
        isError: true
      };
    }
    
    // Generic error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      content: [{
        type: 'text',
        text: `**Error:**\n${errorMessage}\n\nPlease try again with a different query.`
      }],
      isError: true
    };
  }
}
