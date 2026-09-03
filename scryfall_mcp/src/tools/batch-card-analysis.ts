import { ScryfallClient } from '../services/scryfall-client.js';
import { ValidationError, BatchCardAnalysisParams } from '../types/mcp-types.js';
import { MagicFormat } from '../types/scryfall-api.js';
import { normalizeLowercaseString, normalizeStringArray } from '../utils/input-normalization.js';
import {
  analyzeComposition,
  analyzeComprehensive,
  analyzeLegality,
  analyzePrices,
  analyzeSynergy,
  generateSuggestions,
} from './batch-card-analysis/analyzers.js';
import { fetchCardsWithConcurrency } from './batch-card-analysis/fetcher.js';
import { ValidatedBatchCardAnalysisParams } from './batch-card-analysis/types.js';

/**
 * MCP Tool for analyzing multiple cards simultaneously for various metrics
 */
export class BatchCardAnalysisTool {
  readonly name = 'batch_card_analysis';
  readonly description = 'Analyze multiple cards for legality, prices, synergies, or deck composition';

  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      card_list: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of card names to analyze',
        minItems: 1,
        maxItems: 100
      },
      analysis_type: {
        type: 'string',
        enum: ['legality', 'prices', 'synergy', 'composition', 'comprehensive'],
        description: 'Type of analysis to perform'
      },
      format: {
        type: 'string',
        enum: ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer'],
        description: 'Format for legality analysis'
      },
      currency: {
        type: 'string',
        enum: ['usd', 'eur', 'tix'],
        default: 'usd',
        description: 'Currency for price analysis'
      },
      include_suggestions: {
        type: 'boolean',
        default: false,
        description: 'Include improvement suggestions'
      }
    },
    required: ['card_list', 'analysis_type']
  };

  constructor(private readonly scryfallClient: ScryfallClient) {}

  private validateParams(args: unknown): ValidatedBatchCardAnalysisParams {
    if (!args || typeof args !== 'object') {
      throw new ValidationError('Invalid parameters');
    }

    const params = args as BatchCardAnalysisParams;
    const normalizedCardList = normalizeStringArray(params.card_list);
    const normalizedAnalysisType = normalizeLowercaseString(params.analysis_type);
    const normalizedFormat = normalizeLowercaseString(params.format);
    const normalizedCurrency = normalizeLowercaseString(params.currency);

    if (!Array.isArray(normalizedCardList) || normalizedCardList.length === 0) {
      throw new ValidationError('Card list is required and must be a non-empty array');
    }

    if (normalizedCardList.length > 100) {
      throw new ValidationError('Card list cannot exceed 100 cards');
    }

    if (!normalizedCardList.every((card: string) => typeof card === 'string' && card.trim().length > 0)) {
      throw new ValidationError('All cards in the list must be non-empty strings');
    }

    if (!normalizedAnalysisType || typeof normalizedAnalysisType !== 'string') {
      throw new ValidationError('Analysis type is required and must be a string');
    }

    const validAnalysisTypes = ['legality', 'prices', 'synergy', 'composition', 'comprehensive'];
    if (!validAnalysisTypes.includes(normalizedAnalysisType)) {
      throw new ValidationError(`Analysis type must be one of: ${validAnalysisTypes.join(', ')}`);
    }

    if (normalizedFormat) {
      const validFormats = ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pioneer'];
      if (typeof normalizedFormat !== 'string' || !validFormats.includes(normalizedFormat)) {
        throw new ValidationError(`Format must be one of: ${validFormats.join(', ')}`);
      }
    }

    const currency = (typeof normalizedCurrency === 'string' ? normalizedCurrency : undefined) || 'usd';
    const validCurrencies = ['usd', 'eur', 'tix'];
    if (!validCurrencies.includes(currency)) {
      throw new ValidationError(`Currency must be one of: ${validCurrencies.join(', ')}`);
    }

    const includeSuggestions = params.include_suggestions ?? false;
    if (typeof includeSuggestions !== 'boolean') {
      throw new ValidationError('Include suggestions must be a boolean');
    }

    return {
      card_list: normalizedCardList.map((card: string) => card.trim()),
      analysis_type: normalizedAnalysisType as ValidatedBatchCardAnalysisParams['analysis_type'],
      format: normalizedFormat as MagicFormat | undefined,
      currency: currency as ValidatedBatchCardAnalysisParams['currency'],
      include_suggestions: includeSuggestions
    };
  }

  async execute(args: unknown) {
    try {
      const params = this.validateParams(args);
      const cards = await fetchCardsWithConcurrency(this.scryfallClient, params.card_list);

      let analysisResult: string;
      switch (params.analysis_type) {
        case 'legality':
          analysisResult = analyzeLegality(cards, params.format);
          break;
        case 'prices':
          analysisResult = analyzePrices(cards, params.currency);
          break;
        case 'synergy':
          analysisResult = analyzeSynergy(cards);
          break;
        case 'composition':
          analysisResult = analyzeComposition(cards);
          break;
        case 'comprehensive':
          analysisResult = analyzeComprehensive(cards, params);
          break;
        default:
          throw new ValidationError(`Unknown analysis type: ${params.analysis_type}`);
      }

      if (params.include_suggestions) {
        analysisResult += generateSuggestions(cards, params);
      }

      return {
        content: [
          {
            type: 'text',
            text: analysisResult
          }
        ]
      };
    } catch (error) {
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
