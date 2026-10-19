# TBOTT API

## Visão geral
Backend em Express 5 com catálogo dinâmico de rotas e documentação Swagger/OpenAPI. Atualmente, possui apenas rotas de infraestrutura, sem rotas de negócio.

## Arquitetura
- `routes/`: definição das rotas.
- `controller/`: tratamento das requisições.
- `service/`: regras de negócio.
- `repository/`: acesso a dados.
- `docs/`: catálogo e documentação da API.

## Como criar uma rota
1. Declarar a rota com `registerRoute`.
2. Associar um controller e, quando necessário, service e repository.
3. Registrar o módulo em `src/app.js`.

O catálogo e o Swagger são atualizados a partir do mesmo registro, evitando duplicação.

## Documentação
Considerando a URL base configurada no ambiente:

- Interface: `/api`
- Swagger UI: `/api-docs`
- Catálogo JSON: `/api/routes`
- Healthcheck: `/health`
- Status do sistema: `/api/system/status`

## Executar e testar
```bash
npm install
npm run dev
npm test
```

## Observações
As rotas devem ser importadas explicitamente em `src/app.js`. O agrupamento e os detalhes da documentação dependem dos metadados definidos em `registerRoute`.

**Estado atual:** infraestrutura preservada, sem rotas de demonstração e pronta para receber recursos reais.