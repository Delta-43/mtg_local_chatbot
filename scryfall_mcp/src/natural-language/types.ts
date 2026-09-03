/**
 * @fileoverview Type definitions for the Natural Language Query Builder
 * 
 * This module defines all the interfaces and types used throughout the
 * natural language processing pipeline for converting natural language
 * queries into Scryfall search syntax.
 */

// Core parsed query structure
export interface ParsedQuery {
  // Core card properties
  colors: ColorConcept[];
  types: TypeConcept[];
  subtypes: SubtypeConcept[];
  
  // Gameplay mechanics
  keywords: KeywordConcept[];
  abilities: AbilityConcept[];
  mechanics: MechanicConcept[];
  
  // Numeric constraints
  manaCost: ManaCostConcept[];
  powerToughness: StatConcept[];
  priceConstraints: PriceConcept[];
  
  // Format and legality
  formats: FormatConcept[];
  legality: LegalityConcept[];
  
  // Strategic context
  archetypes: ArchetypeConcept[];
  deckRoles: RoleConcept[];
  strategies: StrategyConcept[];
  
  // Set and collection
  sets: SetConcept[];
  rarity: RarityConcept[];
  timeConstraints: TimeConcept[];
  
  // Text and flavor
  namePatterns: NameConcept[];
  flavorText: FlavorConcept[];
  artist: ArtistConcept[];
  
  // Meta information
  confidence: number;
  ambiguities: Ambiguity[];
  context: QueryContext;
}

// Color concept with detailed matching information
export interface ColorConcept {
  colors: string[];           // ['r', 'u'] for red/blue
  exact: boolean;            // true for "exactly red and blue"
  inclusive: boolean;        // true for "red or blue cards"
  exclusive: boolean;        // true for "only red cards"
  multicolor: boolean;       // true for "multicolor cards"
  colorless: boolean;        // true for "colorless cards"
  confidence: number;
}

// Type concept for card types and supertypes
export interface TypeConcept {
  type?: string;             // "creature", "instant", etc.
  supertype?: string;        // "legendary", "basic", etc.
  function?: string;         // "counterspell", "removal", etc.
  confidence: number;
  context?: string;          // surrounding text for context
}

// Subtype concept for creature types, land types, etc.
export interface SubtypeConcept {
  subtype: string;           // "human", "mountain", "equipment", etc.
  category: 'creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker' | 'instant' | 'sorcery';
  confidence: number;
}

// Keyword abilities
export interface KeywordConcept {
  keyword: string;           // "flying", "trample", "haste", etc.
  confidence: number;
}

// Complex abilities
export interface AbilityConcept {
  ability: string;           // "enters the battlefield", "when dies", etc.
  confidence: number;
}

// Game mechanics
export interface MechanicConcept {
  mechanic: string;          // "storm", "cascade", "flashback", etc.
  confidence: number;
}

// Mana cost constraints
export interface ManaCostConcept {
  min?: number;
  max?: number;
  exact?: number;
  comparison?: '=' | '>' | '<' | '>=' | '<=';
  confidence: number;
}

// Power/toughness constraints
export interface StatConcept {
  stat: 'power' | 'toughness';
  min?: number;
  max?: number;
  exact?: number;
  comparison?: '=' | '>' | '<' | '>=' | '<=';
  confidence: number;
}

// Price constraints
export interface PriceConcept {
  max?: number;
  min?: number;
  currency: 'usd' | 'eur' | 'tix';
  condition?: 'budget' | 'value' | 'premium';
  confidence: number;
}

// Format constraints
export interface FormatConcept {
  name: string;              // "standard", "modern", "commander", etc.
  confidence: number;
}

// Legality constraints
export interface LegalityConcept {
  format: string;
  status: 'legal' | 'banned' | 'restricted';
  confidence: number;
}

// Archetype patterns
export interface ArchetypeConcept {
  name: string;              // "aggressive", "control", "combo"
  constraints: {
    cmcRange?: [number, number];
    powerMin?: number;
    keywords?: string[];
    functions?: string[];
    cardTypes?: string[];
  };
  confidence: number;
}

// Deck role concepts
export interface RoleConcept {
  role: string;              // "removal", "threat", "engine", etc.
  confidence: number;
}

// Strategy concepts
export interface StrategyConcept {
  strategy: string;          // "tempo", "value", "synergy", etc.
  confidence: number;
}

// Set constraints
export interface SetConcept {
  setCode?: string;          // "dom", "rna", etc.
  setName?: string;          // "Dominaria", "Ravnica Allegiance", etc.
  confidence: number;
}

// Rarity constraints
export interface RarityConcept {
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic';
  confidence: number;
}

// Time-based constraints
export interface TimeConcept {
  type: 'year' | 'era' | 'recent' | 'old';
  value?: number | string;
  comparison?: '=' | '>' | '<' | '>=' | '<=';
  confidence: number;
}

// Name pattern matching
export interface NameConcept {
  pattern: string;
  exact: boolean;
  confidence: number;
}

// Flavor text concepts
export interface FlavorConcept {
  text: string;
  confidence: number;
}

// Artist concepts
export interface ArtistConcept {
  name: string;
  confidence: number;
}

// Ambiguity detection
export interface Ambiguity {
  type: 'color' | 'type' | 'archetype' | 'price' | 'format' | 'general';
  description: string;
  alternatives: string[];
  confidence: number;
}

// Query context for parsing
export interface QueryContext {
  targetFormat?: string;
  optimizationStrategy?: 'precision' | 'recall' | 'discovery' | 'budget';
  maxResults?: number;
  userIntent?: string;
}

// Concept mapping for query building
export interface ConceptMapping {
  operator: string;
  value: string;
  comparison?: '=' | '>' | '<' | '>=' | '<=' | '!=';
  negation?: boolean;
  conjunction?: boolean;
  confidence: number;
  priority: number; // For conflict resolution
}

// Build options for query generation
export interface BuildOptions {
  optimize_for: 'precision' | 'recall' | 'discovery' | 'budget';
  format?: string;
  max_results?: number;
  price_budget?: PriceBudget;
  test_query?: boolean;
}

// Price budget constraints
export interface PriceBudget {
  max: number;
  currency: 'usd' | 'eur' | 'tix';
}

// Build result with query and metadata
export interface BuildResult {
  query: string;
  explanation: string;
  confidence: number;
  alternatives: AlternativeQuery[];
  optimizations: QueryOptimization[];
  testSummary?: QueryTestSummary;
}

export interface QueryTestSummary {
  total_cards: number;
  has_more: boolean;
}

// Alternative query suggestions
export interface AlternativeQuery {
  query: string;
  description: string;
  type: 'format_restriction' | 'optimization' | 'concept_variation' | 'broadening' | 'narrowing';
  confidence: number;
}

// Query optimization information
export interface QueryOptimization {
  type: 'broadening' | 'narrowing' | 'format_constraint' | 'price_constraint' | 'performance';
  reason: string;
  change: string;
}

// Query part for building
export interface QueryPart {
  query: string;
  explanation: string;
}
