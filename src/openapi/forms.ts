/** Served as a Swagger UI plugin. Requests keep their real application/json encoding. */
export const formsScript = String.raw`
window.AbregiForms = function (system) {
  const React = system.React;
  const h = React.createElement;
  const variants = schema => (schema.oneOf || schema.anyOf || []).filter(s => s.type !== 'null');
  const primary = schema => {
    const options = variants(schema);
    return options.length ? { ...schema, ...(options.find(s => !s.enum || s.enum.some(v => v !== '')) || options[0]), oneOf: undefined, anyOf: undefined } : schema;
  };
  function initial(raw) {
    const schema = primary(raw);
    if (schema.default !== undefined) return schema.default;
    if (schema.enum) return schema.enum[0];
    if (schema.type === 'object' || schema.properties) return Object.fromEntries((schema.required || []).map(key => [key, initial(schema.properties[key])]));
    if (schema.type === 'array') return [];
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return undefined;
    return '';
  }
  const button = (label, onClick, disabled) => h('button', { type: 'button', className: 'btn abregi-button', onClick, disabled }, label);
  function FileField({ value, onChange }) {
    const [error, setError] = React.useState('');
    return h('div', { className: 'abregi-file' },
      h('label', null, 'Fichier', h('input', { type: 'file', onChange: event => {
        const file = event.target.files[0];
        if (!file) return;
        setError('Lecture du fichier…');
        const reader = new FileReader();
        reader.onerror = () => setError('Impossible de lire ce fichier.');
        reader.onload = () => { setError(''); onChange({ ...value, fileName: file.name, contentType: file.type || 'application/octet-stream', data: String(reader.result).split(',')[1] }); };
        reader.readAsDataURL(file);
      } })),
      h('small', { role: 'status' }, error || (value.fileName ? value.fileName + ' — ' + value.contentType : 'Le nom, le type et le contenu seront renseignés automatiquement.')));
  }
  function Field({ schema: raw, value, onChange, name, required = false }) {
    const options = variants(raw);
    const alternatives = options.filter(s => !(s.enum?.length === 1 && s.enum[0] === ''));
    const [choice, setChoice] = React.useState(() => Math.max(0, alternatives.findIndex(s =>
      s.properties ? Object.entries(s.properties).some(([k, p]) => p.enum && p.enum.includes(value?.[k])) :
      s.type === 'array' ? Array.isArray(value) : s.enum ? s.enum.includes(value) : s.type === typeof value)));
    const [newKey, setNewKey] = React.useState('');
    const schema = alternatives.length > 1 ? alternatives[choice] : primary(raw);
    const id = React.useId();
    const enabled = required || value !== undefined;
    const setProperty = (key, next) => {
      const updated = { ...(value || {}) };
      if (next === undefined) delete updated[key]; else updated[key] = next;
      onChange(updated);
    };
    let control;
    if (value === null) control = h('small', null, 'Valeur nulle');
    else if (schema.type === 'object' || schema.properties) {
      const properties = schema.properties || {};
      const upload = properties.fileName && properties.contentType && properties.data;
      const extras = Object.keys(value || {}).filter(key => !(key in properties));
      control = h('div', { className: 'abregi-object' },
        upload ? h(FileField, { value: value || {}, onChange }) : null,
        ...Object.entries(properties).filter(([key]) => !upload || !['fileName', 'contentType', 'data'].includes(key)).map(([key, child]) =>
          h(Field, { key, schema: child, value: value?.[key], onChange: next => setProperty(key, next), name: key, required: (schema.required || []).includes(key) })),
        ...extras.map(key => h('div', { key }, h(Field, { schema: schema.additionalProperties || {type:'string'}, name: key, value: value[key], required: true, onChange: next => setProperty(key,next) }), button('Retirer ' + key, () => setProperty(key, undefined)))),
        schema.additionalProperties && typeof schema.additionalProperties === 'object' ? h('div', { className: 'abregi-add' },
          h('input', { value: newKey, 'aria-label': 'Nouvelle clé pour ' + name, placeholder: 'Nom du champ', onChange: event => setNewKey(event.target.value) }),
          button('Ajouter un champ', () => { setProperty(newKey, initial(schema.additionalProperties)); setNewKey(''); }, !newKey || ['__proto__','constructor','prototype'].includes(newKey) || Object.hasOwn(value || {}, newKey))) : null);
    } else if (schema.type === 'array') {
      const items = Array.isArray(value) ? value : [];
      control = h('div', { className: 'abregi-array' },
        ...items.map((item, index) => h('div', { className: 'abregi-item', key: index },
          h(Field, { schema: schema.items || {type:'string'}, name: name + ' ' + (index + 1), required: true, value: item, onChange: next => onChange(items.map((v,i) => i === index ? next : v)) }),
          button('Retirer', () => onChange(items.filter((_,i) => i !== index))))),
        button('Ajouter un élément', () => onChange([...items, initial(schema.items || {type:'string'})]), schema.maxItems !== undefined && items.length >= schema.maxItems),
        schema.minItems ? h('small', null, 'Minimum : ' + schema.minItems + ' élément(s)') : null);
    } else if (schema.enum || schema.type === 'boolean') {
      const values = schema.enum || [true, false];
      control = h('select', { id, value: value === undefined ? '' : String(values.indexOf(value)), onChange: event => onChange(values[Number(event.target.value)]) },
        h('option', { value: '', disabled: true }, 'Choisir…'),
        ...values.map((v, i) => h('option', { key: i, value: String(i) }, typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : String(v))));
    } else {
      const numeric = schema.type === 'number' || schema.type === 'integer';
      const dateTime = schema.format === 'date-time' || /^(startsAt|endsAt|dueAt|paidAt|receivedAt|setStart|setEnd|issuedAt|purchasedAt|closesAt)$/.test(name);
      const type = numeric ? 'number' : dateTime ? 'datetime-local' : schema.format === 'date' ? 'date' : schema.format === 'email' ? 'email' : /password|secret|token/i.test(name) ? 'password' : 'text';
      let display = value ?? '';
      if (dateTime && value && !Number.isNaN(Date.parse(value))) { const date = new Date(value); display = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,19); }
      const props = { id, type, value: display, min: schema.minimum, max: schema.maximum, minLength: schema.minLength, maxLength: schema.maxLength, step: numeric ? (schema.type === 'integer' ? 1 : 'any') : dateTime ? 1 : undefined, placeholder: schema.example === undefined ? schema.format || schema.type : String(schema.example), autoComplete: 'off', onChange: event => {
        const text = event.target.value;
        onChange(numeric ? (text === '' ? undefined : Number(text)) : dateTime && text ? new Date(text).toISOString() : text);
      } };
      control = /description|notes|message|body|text/i.test(name) ? h('textarea', { ...props, rows: 3 }) : h('input', props);
    }
    return h('div', { className: 'abregi-field', 'data-field': name },
      h('div', { className: 'abregi-label' },
        !required ? h('input', { type: 'checkbox', checked: enabled, 'aria-label': 'Inclure ' + name, onChange: event => onChange(event.target.checked ? initial(raw) : undefined) }) : null,
        h('label', { htmlFor: id }, name, required ? h('span', { className: 'abregi-required' }, ' *') : h('small', null, ' facultatif')),
        h('small', null, schema.type || 'objet'),
        enabled && raw.nullable ? h('label', { className: 'abregi-null' }, h('input', { type: 'checkbox', checked: value === null, onChange: event => onChange(event.target.checked ? null : initial(raw)) }), ' null') : null),
      raw.description ? h('small', null, raw.description) : null,
      enabled ? h(React.Fragment, null,
        alternatives.length > 1 ? h('select', { 'aria-label': 'Variante de ' + name, value: choice, onChange: event => { const next = Number(event.target.value); setChoice(next); onChange(initial(alternatives[next])); } }, ...alternatives.map((variant, i) => h('option', { key: i, value: i }, variant.title || Object.values(variant.properties || {}).find(p => p.enum?.length === 1)?.enum[0] || variant.type || 'Option ' + (i+1)))) : null,
        control) : null);
  }
  function BodyForm(props) {
    const schema = props.requestBody.getIn(['content', 'application/json', 'schema']).toJS();
    const [value, setValue] = React.useState(() => {
      if (props.userHasEditedBody && typeof props.requestBodyValue === 'string') {
        try { return JSON.parse(props.requestBodyValue); } catch { /* Start with a structured form. */ }
      }
      return initial(schema);
    });
    React.useEffect(() => { props.onChange(JSON.stringify(value)); }, [value]);
    React.useEffect(() => { if (!props.userHasEditedBody) setValue(initial(schema)); }, [props.userHasEditedBody]);
    return h('div', { className: 'abregi-form' },
      h('p', null, 'Renseignez les champs. Cochez les champs facultatifs à envoyer.'),
      h('fieldset', { disabled: !props.isExecute }, h(Field, { schema, value, onChange: setValue, name: 'Corps de la requête', required: true })),
      props.requestBodyErrors?.size ? h('p', { role: 'alert', className: 'abregi-required' }, 'Vérifiez les champs obligatoires avant de réessayer.') : null);
  }
  return { wrapComponents: { RequestBody: Original => function RequestBody(props) {
    return props.requestBody?.getIn(['content', 'application/json', 'schema']) ? h(BodyForm, props) : h(Original, props);
  } } };
};
`;

export const formsCss = `
.swagger-ui .abregi-form { background: #fff; border: 1px solid #dce1e8; border-radius: 10px; padding: 18px; }
.swagger-ui .abregi-form fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.swagger-ui .abregi-field { margin: 12px 0; min-width: 0; }
.swagger-ui .abregi-label { display: flex; gap: 9px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.swagger-ui .abregi-label label { font-weight: 600; }
.swagger-ui .abregi-form small { color: #576474; font-size: 12px; }
.swagger-ui .abregi-required { color: #b42318; }
.swagger-ui .abregi-form input:not([type=checkbox]), .swagger-ui .abregi-form select, .swagger-ui .abregi-form textarea { width: 100%; max-width: 100%; border: 1px solid #b9c3cf; border-radius: 6px; padding: 9px 11px; background: #fff; color: #172b4d; }
.swagger-ui .abregi-form input:focus, .swagger-ui .abregi-form select:focus, .swagger-ui .abregi-form textarea:focus { outline: 2px solid #2563eb; outline-offset: 2px; }
.swagger-ui .abregi-form input[type=checkbox] { margin: 0; width: 16px; height: 16px; }
.swagger-ui .abregi-object { border-left: 2px solid #e4e9f0; padding-left: 16px; }
.swagger-ui .abregi-item { border: 1px solid #e4e9f0; border-radius: 7px; padding: 10px; margin: 8px 0; }
.swagger-ui .abregi-button { margin: 6px 6px 6px 0; font-size: 12px; padding: 6px 12px; }
.swagger-ui .abregi-add { display: flex; gap: 8px; align-items: center; }
.swagger-ui .abregi-file { padding: 12px; background: #f4f7fb; border-radius: 8px; }
@media (max-width: 640px) { .swagger-ui .abregi-form { padding: 10px; } .swagger-ui .abregi-object { padding-left: 8px; } }
`;
