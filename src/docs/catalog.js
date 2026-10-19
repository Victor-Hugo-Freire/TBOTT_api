const routeRegistry = new Map();

export const normalizeRoutePath = (routePath) => (Array.isArray(routePath) ? routePath[0] : routePath);

export const toOpenApiPath = (routePath) => normalizeRoutePath(routePath).replace(/\/:(\w+)/g, '/{$1}');

export const getCategoryName = (routePath) => {
  if (!routePath || routePath === '/') {
    return 'Sistema';
  }

  const firstSegment = routePath.split('/').filter(Boolean)[0] ?? 'Sistema';
  if (!firstSegment) {
    return 'Sistema';
  }

  return firstSegment
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const getRouteDescription = (method, routePath) => {
  if (routePath === '/') {
    return 'Página de documentação interativa da API e rota de verificação do serviço.';
  }

  const suffix = routePath.includes(':') ? ' de um recurso específico.' : ' da funcionalidade atual.';

  if (method === 'GET') {
    return `Consulta ${suffix}`;
  }

  if (method === 'POST') {
    return `Cria ${suffix}`;
  }

  if (method === 'PUT') {
    return `Atualiza ${suffix}`;
  }

  if (method === 'PATCH') {
    return `Aplica alterações parciais ${suffix}`;
  }

  if (method === 'DELETE') {
    return `Remove ${suffix}`;
  }

  if (method === 'HEAD') {
    return 'Verifica a disponibilidade do recurso sem retornar o corpo da resposta.';
  }

  return 'Endpoint registrado na aplicação.';
};

export const registerRoute = ({
  method,
  path,
  category,
  description,
  summary,
  auth = 'Não aplicável',
  parameters = [],
  responses = {},
  tags = [],
  hidden = false,
  app,
  router,
  handler,
  prefix = '',
  requestBody,
  kind = 'business'
}) => {
  const methodName = String(method).toUpperCase();
  const routePath = normalizeRoutePath(path);
  const basePath = prefix ? prefix.replace(/\/$/, '') : '';
  const fullPath = basePath ? `${basePath}${routePath}` : routePath;
  const key = `${methodName} ${fullPath}`;
  const target = app ?? router;

  if (target && typeof target[methodName.toLowerCase()] === 'function') {
    const routeHandler = handler ?? ((_req, res) => {
      res.json({
        ok: true,
        method: methodName,
        path: fullPath
      });
    });

    target[methodName.toLowerCase()](routePath, routeHandler);
  }

  const route = {
    method: methodName,
    path: fullPath,
    category: category || getCategoryName(fullPath),
    description: description || getRouteDescription(methodName, fullPath),
    summary: summary || `${methodName} ${fullPath}`,
    auth,
    parameters,
    responses,
    tags: tags.length ? tags : [category || getCategoryName(fullPath)],
    hidden,
    requestBody,
    kind
  };

  routeRegistry.set(key, route);
  return route;
};

export const getRoutes = () => Array.from(routeRegistry.values()).sort((left, right) => {
  if (left.path === right.path) {
    return left.method.localeCompare(right.method);
  }

  return left.path.localeCompare(right.path);
});

export const getDocumentedRoutes = () => getRoutes().filter((route) => !route.hidden);

export const clearRoutes = () => routeRegistry.clear();

export const groupRoutesByCategory = (routes) => {
  const grouped = {};

  for (const route of routes) {
    if (!grouped[route.category]) {
      grouped[route.category] = [];
    }

    grouped[route.category].push(route);
  }

  return Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right));
};

export const createSwaggerSpec = (runtimeConfig) => {
  const paths = {};

  for (const route of getDocumentedRoutes()) {
    const pathKey = toOpenApiPath(route.path);
    const methodKey = route.method.toLowerCase();

    paths[pathKey] ??= {};
    const openApiRoute = {
      summary: route.summary || `${route.method} ${route.path}`,
      description: route.description,
      tags: route.tags.length ? route.tags : [route.category],
      parameters: (route.parameters ?? []).map((parameter) => ({
        name: parameter.name,
        in: parameter.in,
        required: Boolean(parameter.required),
        description: parameter.description,
        schema: parameter.schema || { type: 'string' }
      })),
      responses: route.responses && Object.keys(route.responses).length
        ? route.responses
        : {
            200: { description: 'Requisição concluída com sucesso.' },
            400: { description: 'Dados inválidos ou ausentes.' },
            401: { description: 'Autenticação necessária.' },
            404: { description: 'Recurso não encontrado.' }
          }
    };

    if (route.requestBody) {
      openApiRoute.requestBody = {
        required: Boolean(route.requestBody.required),
        content: Object.fromEntries(Object.entries(route.requestBody.content ?? {}).map(([contentType, value]) => [
          contentType,
          {
            schema: value.schema,
            example: value.example
          }
        ]))
      };
    }

    paths[pathKey][methodKey] = openApiRoute;
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'TBOTT API',
      version: '1.0.0',
      description: 'Documentação automática gerada a partir das rotas registradas na aplicação.'
    },
    servers: [{ url: `http://localhost:${runtimeConfig.port}` }],
    paths
  };
};
