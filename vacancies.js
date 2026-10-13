(async function () {
  const host = document.getElementById('public-vacancies');
  const fields = document.getElementById('careers-fields');
  if (!host || !fields) return;
  try {
    const response = await fetch('https://intranet.tiendasimportados.com/api/vacancies', {
      signal: AbortSignal.timeout(10000), cache: 'no-store'
    });
    if (!response.ok) return;
    const { vacancies = [] } = await response.json();
    if (!vacancies.length) return;

    const title = document.createElement('h3');
    title.textContent = 'Vacantes disponibles';
    host.append(title);
    for (const item of vacancies) {
      const card = document.createElement('details');
      const heading = document.createElement('summary');
      const content = document.createElement('p');
      const branch = item.branch_id === 'niquia' ? 'Niquía' : item.branch_id === 'santa-lucia' ? 'Santa Lucía' : 'Ambas sedes';
      heading.textContent = item.title + ' · ' + branch;
      content.textContent = item.description + '\n\n' + item.requirements;
      card.append(heading, content);
      host.append(card);
    }

    const label = document.createElement('label');
    const select = document.createElement('select');
    label.textContent = '¿Quieres postularte a una vacante?';
    select.name = 'vacancy_id';
    const general = document.createElement('option');
    general.value = '';
    general.textContent = 'Postulación general';
    select.append(general);
    for (const item of vacancies) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title;
      select.append(option);
    }
    label.append(select);
    fields.prepend(label);
    host.hidden = false;
  } catch {
    // La postulación general permanece disponible si no se pueden cargar vacantes.
  }
})();
