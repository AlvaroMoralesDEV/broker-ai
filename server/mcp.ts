// Servidor MCP (stdio): expone las mismas herramientas que usa el asistente de la web para que
// Claude Desktop, Claude Code u otro cliente MCP pueda buscar viviendas y calcular tu hipoteca.
//
//   claude mcp add hipoteca -- npx tsx C:/ruta/a/hipoteca-searcher/server/mcp.ts
//
import "./env.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS, loadProfile, type ToolContext, type ToolName } from "./tools.ts";

const server = new McpServer({ name: "hipoteca-searcher", version: "0.1.0" });

for (const name of Object.keys(TOOLS) as ToolName[]) {
  const tool = TOOLS[name];
  server.registerTool(name, { description: tool.description, inputSchema: tool.schema.shape }, async (input: unknown) => {
    try {
      // el perfil se relee en cada llamada: es el que guardas desde la web (data/profile.json)
      const ctx: ToolContext = { profile: loadProfile() };
      const output = await (tool.run as (i: unknown, c: ToolContext) => Promise<unknown>)(input, ctx);
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] };
    }
  });
}

await server.connect(new StdioServerTransport());
