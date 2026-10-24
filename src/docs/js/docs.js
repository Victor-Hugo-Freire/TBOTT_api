const routeContainer = document.getElementById('routesContainer');
const searchInput = document.getElementById('searchInput');
const routeFilter = document.getElementById('routeFilter');
const methodFilter = document.getElementById('methodFilter');
const categoryFilter = document.getElementById('categoryFilter');

let routes = [];

const escapeHtml = (value = '') => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const groupRoutesByCategory = (items) => {
  const grouped = {};

  for (const route of items) {
    if (!grouped[route.category]) {
      grouped[route.category] = [];
    }

    grouped[route.category].push(route);
  }

  return Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right));
};

const renderRouteCard = (route) => {
  const parameters = route.parameters?.length
    ? route.parameters
        .map((parameter) => `<li><strong>${escapeHtml(parameter.name)}</strong> (${escapeHtml(parameter.in)}) - ${escapeHtml(parameter.description)}</li>`)
        .join('')
    : '<li>Nenhum parâmetro específico.</li>';

  return `
    <article class="route-card">
      <div class="route-header">
        <span class="method method-${route.method.toLowerCase()}">${escapeHtml(route.method)}</span>
        <code>${escapeHtml(route.path)}</code>
      </div>
      <p>${escapeHtml(route.description)}</p>
      <div class="meta-grid">
        <div>
          <h4>Autenticação</h4>
          <p>${escapeHtml(route.auth)}</p>
        </div>
        <div>
          <h4>Parâmetros</h4>
          <ul>${parameters}</ul>
        </div>
      </div>
    </article>
  `;
};

const renderDocumentation = () => {
  const selectedRoute = routeFilter.value;
  const selectedMethod = methodFilter.value;
  const selectedCategory = categoryFilter.value;
  const searchValue = searchInput.value.trim().toLowerCase();

  const filteredRoutes = routes.filter((route, index) => {
    const matchesRoute = selectedRoute === 'all' || String(index) === selectedRoute;
    const matchesMethod = selectedMethod === 'all' || route.method === selectedMethod;
    const matchesCategory = selectedCategory === 'all' || route.category === selectedCategory;
    const matchesSearch = !searchValue || `${route.path} ${route.description}`.toLowerCase().includes(searchValue);

    return matchesRoute && matchesMethod && matchesCategory && matchesSearch;
  });

  const categories = groupRoutesByCategory(filteredRoutes);

  if (!categories.length) {
    routeContainer.innerHTML = '<div class="empty-state">Nenhuma rota corresponde aos filtros selecionados.</div>';
    return;
  }

  routeContainer.innerHTML = categories
    .map(([category, categoryRoutes]) => `
      <section class="category-block">
        <h3>${escapeHtml(category)}</h3>
        ${categoryRoutes.map((route) => renderRouteCard(route)).join('')}
      </section>
    `)
    .join('');
};

const populateCategoryFilter = () => {
  const categories = groupRoutesByCategory(routes);
  const options = ['<option value="all">Todas as categorias</option>']
    .concat(categories.map(([category]) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`));

  categoryFilter.innerHTML = options.join('');
};

const populateRouteFilter = () => {
  const options = ['<option value="all">Todas as rotas</option>']
    .concat(routes.map((route, index) => {
      const label = `${route.method} ${route.path}`;
      return `<option value="${index}">${escapeHtml(label)}</option>`;
    }));

  routeFilter.innerHTML = options.join('');
};

const initializeDocumentation = async () => {
  try {
    const response = await fetch('/api/routes');
    if (!response.ok) {
      throw new Error('Não foi possível carregar as rotas');
    }

    const payload = await response.json();
    routes = Array.isArray(payload.routes) ? payload.routes : [];

    populateRouteFilter();
    populateCategoryFilter();
    renderDocumentation();
  } catch (error) {
    routeContainer.innerHTML = `<div class="empty-state">Erro ao carregar a documentação: ${escapeHtml(error.message)}</div>`;
  }
};

searchInput.addEventListener('input', renderDocumentation);
routeFilter.addEventListener('change', renderDocumentation);
methodFilter.addEventListener('change', renderDocumentation);
categoryFilter.addEventListener('change', renderDocumentation);

initializeDocumentation();
