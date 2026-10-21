# Cloud ChatGPT connection path

The implemented runtime is local stdio. It makes no OpenAI model API calls. ChatGPT supplies the model; this software supplies tools and durable state.

## Private cloud-chat access

OpenAI documents Secure MCP Tunnel as a way to connect a private stdio or HTTP MCP server to ChatGPT. Where your account/workspace exposes it, configure the tunnel's server command to run:

```text
/absolute/path/to/node /absolute/path/to/dungeon-master/dist/server.js --campaign /absolute/path/to/campaign
```

Register the tunnel-backed server through ChatGPT's custom MCP/plugin flow, then attach the DM skills to that integration as supported by your client. Use one project per campaign and normally a new conversation per session. Check campaign_status before play and test a save followed by a fresh-chat resume.

Account availability, tunnel registration and app installation must be verified in the target account. This repository does not invent a tunnel URL/ID, automatically register a service or claim that a connected endpoint was tested. The local machine, tunnel client and campaign files must remain available. Closing a cloud chat does not move the local data into ChatGPT storage.

Current official guidance:

- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/plugins

## Later hosted MCP deployment

A future deployment can wrap `createMcpServer` in Streamable HTTP without changing the domain service or tool schemas. Provision a persistent campaign volume, run journal-rag next to it, and keep the server instance bound to an authorized campaign. Add authentication and authorization before exposing any remote endpoint. Do not use audience=party as authorization.

The initial hosted shape should remain one operator and one active writer per campaign. Use persistent snapshots/backups, observe operation failures and pending journal counts, and test restore before relying on the host. Credentials, public endpoint registration, hosting provider, multi-tenancy and public directory submission are intentionally not implemented here.

The cloud ChatGPT project can organize conversations and references. Do not assume it hosts the Node process, local embedding daemon or durable writable filesystem. No verified cost comparison is claimed; local execution avoids a separate hosting bill while requiring an available machine.
