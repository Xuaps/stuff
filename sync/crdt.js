import * as Y from "yjs";

export const ENTITY_TYPES = ["tasks", "projects", "areas", "headings"];

export function createCrdtDoc() {
  const doc = new Y.Doc();
  const entities = Object.fromEntries(ENTITY_TYPES.map(type => [type, doc.getMap(type)]));
  return { doc, entities };
}

export function applyState(entities, state, origin = "store") {
  for (const type of ENTITY_TYPES) {
    const incoming = new Map((state?.[type] || []).map(record => [String(record.id), record]));
    const map = entities[type];
    map.forEach((entity, id) => {
      if (!incoming.has(id)) map.delete(id);
    });
    for (const [id, record] of incoming) {
      let entity = map.get(id);
      if (!(entity instanceof Y.Map)) {
        entity = new Y.Map();
        map.set(id, entity);
      }
      for (const key of [...entity.keys()]) if (!(key in record)) entity.delete(key);
      for (const [key, value] of Object.entries(record)) entity.set(key, clone(value));
    }
  }
  return origin;
}

export function stateFromDoc(entities) {
  return Object.fromEntries(ENTITY_TYPES.map(type => [type, [...entities[type].entries()].map(([id, entity]) => ({
    id,
    ...(entity instanceof Y.Map ? Object.fromEntries(entity.entries()) : entity),
  }))]));
}

export function connectConvergentDocs(left, right) {
  Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc), "transport");
  Y.applyUpdate(left.doc, Y.encodeStateAsUpdate(right.doc), "transport");
  const forward = update => Y.applyUpdate(right.doc, update, "transport");
  const backward = update => Y.applyUpdate(left.doc, update, "transport");
  left.doc.on("update", forward);
  right.doc.on("update", backward);
  return () => { left.doc.off("update", forward); right.doc.off("update", backward); };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
