export interface Source {
  id: string;
  title: string;
  url: string;
  content?: string;
  retrievedAt: string;
  publishedAt?: string | null;
  historical?: boolean;
}
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: number;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources: Source[];
  metadata: Record<string, unknown>;
}
export interface DateReference {
  day: string;
  expression: string;
  timezone: string;
}
export interface RetrievedMemory {
  id: number;
  conversationId: string;
  askedAt: string;
  localDate: string;
  question: string;
  answer: string | null;
  answeredAt: string | null;
  sources: Source[];
}
export interface MemoryContext {
  date: DateReference | null;
  memories: RetrievedMemory[];
  total: number;
  truncated: boolean;
}
/** A minimal owner-scoped user-message projection, never assistant or source content. */
export interface RecentQuestion {
  id: number;
  content: string;
  createdAt: string;
}
export interface PromptSuggestion {
  id: string;
  text: string;
  kind: "generic" | "history";
  topic?: string;
}
export interface SuggestionsResponse {
  suggestions: PromptSuggestion[];
  personalized: boolean;
}
export interface MemoryStore {
  createConversation(now?: string): Promise<Conversation>;
  conversation(id: string): Promise<Conversation | null>;
  conversations(): Promise<Conversation[]>;
  messages(id: string, limit?: number): Promise<Message[]>;
  recentQuestions(limit?: number): Promise<RecentQuestion[]>;
  addMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    createdAt?: string,
    sources?: Source[],
    metadata?: Record<string, unknown>,
  ): Promise<Message>;
  retrieve(
    query: string,
    now?: Date,
    timezone?: string,
  ): Promise<MemoryContext>;
  acquireLease(
    conversationId: string,
    leaseToken: string,
    expiresAt: string,
  ): Promise<boolean>;
  releaseLease(conversationId: string, leaseToken: string): Promise<void>;
}
export interface Status {
  mode: "demo" | "live" | "setup";
  model: string;
  timezone: string;
  configured: boolean;
  storage: "memory" | "neon";
  auth: "local" | "cloudflare-access" | "required";
  missing: string[];
}
export type AgentEvent = "status" | "memory" | "delta" | "done" | "error";
export type Emit = (event: AgentEvent, data: unknown) => void;
export interface SearchResult {
  query: string;
  retrievedAt: string;
  cached: boolean;
  results: Omit<Source, "id" | "retrievedAt">[];
}
export interface SearchClient {
  search(
    query: string,
    options?: { fresh?: boolean; signal?: AbortSignal },
  ): Promise<SearchResult>;
}
export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ToolCall {
  id: string;
  callId: string;
  name: string;
  arguments: string;
}
export interface ModelResult {
  text: string;
  toolCalls: ToolCall[];
  output: Record<string, unknown>[];
}
export interface ModelRequest {
  input: Record<string, unknown>[];
  instructions: string;
  tools: Record<string, unknown>[];
  toolChoice?: "auto" | "required" | "none";
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResult>;
}
