// =============================================================================
// @obsku/framework — Memory extraction prompts
// =============================================================================

/**
 * Prompt for extracting entities from LLM responses.
 * Returns JSON array of entities with name, type, and attributes.
 *
 * @example
 * Input: "John mentioned he works at Acme Corp in the security department."
 * Output: [{"name": "John", "type": "person", "attributes": {"employer": "Acme Corp", "department": "security"}}, {"name": "Acme Corp", "type": "organization", "attributes": {}}]
 */
export const ENTITY_EXTRACTION_PROMPT = `Extract all named entities from the following text. Return ONLY a JSON array, no markdown formatting or explanation.

Each entity should have:
- "name": The entity name (string)
- "type": Entity type - one of: "person", "organization", "domain", "ip", "url", "file", "service", "port", "vulnerability", "tool", "other" (string)
- "attributes": Key-value pairs of relevant attributes (object)
- "relationships": Array of relationships to other entities in format {"type": "relationship_type", "targetName": "other_entity_name"} (optional)

Guidelines:
- Extract people, organizations, domains, IPs, URLs, file paths, services, ports, vulnerabilities, and tools
- Include relevant attributes like roles, versions, descriptions
- For technical entities (domains, IPs), include any discovered metadata
- Relationships should describe how entities relate (e.g., "owns", "manages", "hosts", "resolves_to")

Return format: [{"name": "...", "type": "...", "attributes": {...}, "relationships": [...]}]

If no entities found, return: []

Text to analyze:
`;

/**
 * Prompt for extracting facts/knowledge from conversation summaries.
 * Returns JSON array of facts with content and confidence.
 *
 * @example
 * Input: "The scan revealed that example.com uses nginx 1.19 and has open ports 80, 443."
 * Output: [{"content": "example.com runs nginx version 1.19", "confidence": 0.9}, {"content": "example.com has ports 80 and 443 open", "confidence": 0.95}]
 */
export const FACT_EXTRACTION_PROMPT = `Extract key facts and learnings from the following conversation summary. Return ONLY a JSON array, no markdown formatting or explanation.

Each fact should have:
- "content": A clear, standalone statement of the fact (string)
- "confidence": How confident you are in this fact, 0.0 to 1.0 (number)

Guidelines:
- Extract actionable knowledge that would be useful in future conversations
- Focus on technical facts: configurations, vulnerabilities, infrastructure details
- Include user preferences and patterns observed
- Assign higher confidence (0.8-1.0) to explicitly stated facts
- Assign lower confidence (0.5-0.7) to inferred facts
- Skip trivial or obvious facts

Return format: [{"content": "...", "confidence": 0.9}]

If no significant facts found, return: []

Conversation summary:
`;

/**
 * Prompt for summarizing a conversation for long-term storage.
 * Returns a concise summary capturing key events and outcomes.
 */
export const CONVERSATION_SUMMARY_PROMPT = `Summarize the following conversation for long-term memory storage. Return ONLY the summary text, no formatting.

Focus on:
- Key decisions made
- Actions taken and their outcomes
- Important findings or discoveries
- User preferences expressed
- Unresolved items or next steps

Keep the summary concise (2-4 paragraphs) but comprehensive.

Conversation:
`;
