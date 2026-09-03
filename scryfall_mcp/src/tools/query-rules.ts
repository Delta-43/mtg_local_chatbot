import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '../types/mcp-types.js';
import { mcpLogger } from '../services/logger.js';

const RULES_PATH = fileURLToPath(new URL('../../mtgrules.txt', import.meta.url));

/**
 * MCP Tool for searching Magic: The Gathering comprehensive rules
 */
export class QueryRulesTool {
  readonly name = 'query_rules';
  readonly description = 'Search Magic: The Gathering comprehensive rules for specific interactions and rule clarifications';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search term or rules question'
      },
      section: {
        type: 'string',
        description: 'Specific rule section (e.g., "7" for Additional Rules)',
        pattern: '^[1-9]\\d*$'
      },
      context_lines: {
        type: 'number',
        default: 3,
        minimum: 1,
        maximum: 10,
        description: 'Lines of context around matches'
      },
      exact_match: {
        type: 'boolean',
        default: false,
        description: 'Require exact phrase matching'
      }
    },
    required: ['query']
  };

  private rulesContent: string | null = null;
  private rulesLines: string[] = [];

  constructor() {
    this.loadRulesFile();
  }

  private isValidParams(
    value: unknown
  ): value is {
    query: string;
    section?: string;
    context_lines?: number;
    exact_match?: boolean;
  } {
    return !!value && typeof value === 'object';
  }

  /**
   * Load the MTG rules file into memory
   */
  private loadRulesFile(): void {
    try {
      this.rulesContent = readFileSync(RULES_PATH, 'utf-8');
      this.rulesLines = this.rulesContent.split('\n');
    } catch (error) {
      mcpLogger.warn({ operation: 'rules_load', error }, 'Could not load MTG rules file');
      this.rulesContent = null;
      this.rulesLines = [];
    }
  }

  /**
   * Validate parameters using Zod-like validation
   */
  private validateParams(args: unknown): {
    query: string;
    section?: string;
    context_lines: number;
    exact_match: boolean;
  } {
    if (!args || typeof args !== 'object') {
      throw new ValidationError('Invalid parameters');
    }

    if (!this.isValidParams(args)) {
      throw new ValidationError('Invalid parameters');
    }

    const params = args;

    if (!params.query || typeof params.query !== 'string' || params.query.trim().length === 0) {
      throw new ValidationError('Query is required and must be a non-empty string');
    }

    if (params.section && (typeof params.section !== 'string' || !/^[1-9]\d*$/.test(params.section))) {
      throw new ValidationError('Section must be a positive number as string');
    }

    const contextLines = params.context_lines ?? 3;
    if (typeof contextLines !== 'number' || contextLines < 1 || contextLines > 10) {
      throw new ValidationError('Context lines must be a number between 1 and 10');
    }

    const exactMatch = params.exact_match ?? false;
    if (typeof exactMatch !== 'boolean') {
      throw new ValidationError('Exact match must be a boolean');
    }

    return {
      query: params.query.trim(),
      section: params.section,
      context_lines: contextLines,
      exact_match: exactMatch
    };
  }

  /**
   * Search for rules matching the query
   */
  private searchRules(params: {
    query: string;
    section?: string;
    context_lines: number;
    exact_match: boolean;
  }): Array<{
    lineNumber: number;
    line: string;
    context: string[];
    section: string;
  }> {
    if (!this.rulesContent || this.rulesLines.length === 0) {
      return [];
    }

    const results: Array<{
      lineNumber: number;
      line: string;
      context: string[];
      section: string;
    }> = [];

    // Create search pattern
    let searchPattern: RegExp;
    if (params.exact_match) {
      // Exact phrase match, case insensitive
      searchPattern = new RegExp(params.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } else {
      // Flexible search - split query into words and match all
      const words = params.query.toLowerCase().split(/\s+/).filter(word => word.length > 0);
      const pattern = words.map(word => `(?=.*\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).join('');
      searchPattern = new RegExp(pattern, 'i');
    }

    // Track current section for context
    let currentSection = '';

    for (let i = 0; i < this.rulesLines.length; i++) {
      const line = this.rulesLines[i];
      
      // Update current section if we hit a section header
      const sectionMatch = line.match(/^(\d+)\.\s/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
      }

      // Skip if section filter is specified and doesn't match
      if (params.section && currentSection !== params.section) {
        continue;
      }

      // Check if line matches search pattern
      if (searchPattern.test(line)) {
        // Get context lines
        const contextStart = Math.max(0, i - params.context_lines);
        const contextEnd = Math.min(this.rulesLines.length - 1, i + params.context_lines);
        
        const context: string[] = [];
        for (let j = contextStart; j <= contextEnd; j++) {
          const contextLine = this.rulesLines[j];
          if (j === i) {
            // Mark the matching line
            context.push(`>>> ${contextLine}`);
          } else {
            context.push(`    ${contextLine}`);
          }
        }

        results.push({
          lineNumber: i + 1,
          line: line,
          context: context,
          section: currentSection || 'Unknown'
        });
      }
    }

    return results;
  }

  async execute(args: unknown) {
    try {
      // Check if rules file is available
      if (!this.rulesContent) {
        return {
          content: [
            {
              type: 'text',
              text: 'MTG rules file is not available. Please ensure mtgrules.txt is present in the project root.'
            }
          ],
          isError: true
        };
      }

      // Validate parameters
      const params = this.validateParams(args);

      // Search for matching rules
      const results = this.searchRules(params);

      // Handle no results
      if (results.length === 0) {
        let message = `No rules found matching "${params.query}"`;
        if (params.section) {
          message += ` in section ${params.section}`;
        }
        message += '. Try adjusting your search terms or removing section filters.';

        return {
          content: [
            {
              type: 'text',
              text: message
            }
          ]
        };
      }

      // Format results
      let responseText = `Found ${results.length} rule${results.length === 1 ? '' : 's'} matching "${params.query}"`;
      if (params.section) {
        responseText += ` in section ${params.section}`;
      }
      responseText += ':\n\n';

      for (const result of results.slice(0, 10)) { // Limit to 10 results
        responseText += `**Section ${result.section}, Line ${result.lineNumber}:**\n`;
        responseText += result.context.join('\n') + '\n\n';
      }

      if (results.length > 10) {
        responseText += `... and ${results.length - 10} more results. Refine your search for more specific results.\n`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };

    } catch (error) {
      // Handle validation errors
      if (error instanceof ValidationError) {
        return {
          content: [
            {
              type: 'text',
              text: `Validation error: ${error.message}`
            }
          ],
          isError: true
        };
      }

      // Generic error handling
      return {
        content: [
          {
            type: 'text',
            text: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }
        ],
        isError: true
      };
    }
  }
}
