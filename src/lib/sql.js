// Collects WHERE conditions and their bound parameters for one query, so
// every value reaches PostgreSQL as a $n parameter, never as SQL text.
export class Conditions {
  constructor() {
    this.params = [];
    this.clauses = [];
  }

  // Adds a value and returns its placeholder, e.g. "$3".
  bind(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  // Adds a condition such as `d.district_id = ?`; the ? becomes a placeholder.
  add(clause, value) {
    this.clauses.push(clause.replace('?', this.bind(value)));
  }

  // Adds a fixed condition that carries no client-supplied value.
  addFixed(clause) {
    this.clauses.push(clause);
  }

  get where() {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}
