import { PromptDefinition, ResourceDefinition, ToolDefinition } from './mcp-types.js';

export interface ToolResponseContent {
  type: string;
  text: string;
}

export interface ToolResponse {
  content: ToolResponseContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface ToolContract extends ToolDefinition {
  execute(args: unknown): Promise<ToolResponse>;
}

export interface ResourceContract extends ResourceDefinition {
  getData(): Promise<string>;
  destroy?(): void | Promise<void>;
}

export interface PromptContract extends PromptDefinition {
  generatePrompt(args: Record<string, string>): Promise<string>;
}

export function createNamedRegistry<T extends { name: string }>(entries: readonly T[]): Map<string, T> {
  return new Map(entries.map(entry => [entry.name, entry]));
}

export function createUriRegistry<T extends { uri: string }>(entries: readonly T[]): Map<string, T> {
  return new Map(entries.map(entry => [entry.uri, entry]));
}
