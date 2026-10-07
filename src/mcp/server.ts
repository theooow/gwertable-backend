import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AGENT_INSTRUCTIONS, agentTools, type AgentToolContext } from "./tools.js";

export function createMcpServer(context: AgentToolContext): McpServer {
  const server = new McpServer({ name: "abregi", title: "Abregi", version: "0.1.0" }, { instructions: AGENT_INSTRUCTIONS });

  for (const tool of agentTools(context.canWrite)) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input.shape,
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, openWorldHint: false },
    }, async (input) => {
      const { text, isError } = await tool.run(context, input);
      return { content: [{ type: "text", text }], isError };
    });
  }

  return server;
}
