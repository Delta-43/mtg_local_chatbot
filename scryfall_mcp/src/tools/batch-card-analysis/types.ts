import { BatchCardAnalysisParams } from '../../types/mcp-types.js';

export interface ValidatedBatchCardAnalysisParams extends BatchCardAnalysisParams {
  analysis_type: BatchCardAnalysisParams['analysis_type'];
  currency: NonNullable<BatchCardAnalysisParams['currency']>;
  include_suggestions: boolean;
}
