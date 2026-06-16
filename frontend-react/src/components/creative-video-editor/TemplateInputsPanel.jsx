import { useEffect, useMemo, useState } from 'react';

function normalizeFields(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  if (schema?.properties && typeof schema.properties === 'object') {
    return Object.entries(schema.properties).map(([name, config]) => ({ name, ...(config || {}) }));
  }
  return [];
}

function getFieldValue(values, field) {
  return values?.[field.name] ?? values?.[field.id] ?? field.default ?? (field.type === 'boolean' ? false : '');
}

function renderInput(field, value, disabled, onChange) {
  const type = field.type || 'string';
  const options = field.options || field.enum || field.values || [];

  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
      />
    );
  }

  if (type === 'number') {
    return (
      <input
        type="number"
        value={value ?? ''}
        disabled={disabled}
        onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
    );
  }

  if (type === 'enum') {
    return (
      <select value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">请选择</option>
        {options.map(option => {
          const optionValue = typeof option === 'object' ? option.value : option;
          const optionLabel = typeof option === 'object' ? (option.label || option.value) : option;
          return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    );
  }

  if (type === 'array') {
    return (
      <textarea
        value={Array.isArray(value) ? value.join('\n') : value || ''}
        disabled={disabled}
        rows={3}
        onChange={event => onChange(event.target.value.split('\n').map(item => item.trim()).filter(Boolean))}
      />
    );
  }

  return (
    <input
      value={value ?? ''}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    />
  );
}

export function TemplateInputsPanel({ schema, values = {}, disabled, onSave }) {
  const fields = useMemo(() => normalizeFields(schema), [schema]);
  const [draft, setDraft] = useState(values || {});

  useEffect(() => {
    setDraft(values || {});
  }, [values]);

  function updateField(field, value) {
    setDraft(prev => ({ ...prev, [field.name || field.id]: value }));
  }

  return (
    <section className="creative-video-editor-panel html-video-template-inputs">
      <div className="creative-video-editor-panel-header">
        <h3>模板字段</h3>
        <button type="button" disabled={disabled} onClick={() => onSave(draft)}>保存模板字段</button>
      </div>
      {fields.length ? fields.map(field => {
        const key = field.name || field.id;
        return (
          <label key={key}>
            <span>{field.label || key}</span>
            {renderInput(field, getFieldValue(draft, field), disabled, value => updateField(field, value))}
          </label>
        );
      }) : <p>暂无模板字段</p>}
    </section>
  );
}
