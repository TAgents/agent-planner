/**
 * Supabase compatibility shim for v2
 * 
 * Provides a supabase-like API backed by the DAL/Drizzle.
 * This allows existing controllers to work without immediate rewrites.
 * 
 * Supports: .from(table).select().eq().single() etc.
 */
const { db } = require('../db/connection.cjs');

class QueryBuilder {
  constructor(tableName) {
    this.tableName = tableName;
    this._filters = [];
    this._select = '*';
    this._orderBy = null;
    this._limitVal = null;
    this._offsetVal = null;
    this._single = false;
    this._insertData = null;
    this._updateData = null;
    this._deleteMode = false;
    this._inFilters = [];
    this._neqFilters = [];
    this._overlapsFilters = [];
    this._notFilters = [];
    this._returning = false;
    this._upsertMode = false;
    this._upsertConflict = null;
    this._countMode = false;
    this._headMode = false;
    this._ilike = [];
    this._or = null;
    this._gte = [];
    this._lte = [];
    this._is = [];
    this._rangeFrom = null;
    this._rangeTo = null;
  }

  select(fields, opts) {
    this._select = fields || '*';
    this._returning = true;
    if (opts && opts.count === 'exact') this._countMode = true;
    if (opts && opts.head) this._headMode = true;
    // Strip Supabase relation syntax: "alias:fk_col (col1, col2)" → "fk_col"
    // Also handle "table (col1, col2)" → remove entirely
    if (typeof this._select === 'string' && this._select !== '*') {
      this._select = this._parseSelectFields(this._select);
    }
    return this;
  }

  _parseSelectFields(fields) {
    // Split on commas that are NOT inside parentheses
    const parts = [];
    let depth = 0, current = '';
    for (const ch of fields) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());

    const cleaned = [];
    for (const part of parts) {
      // Skip embedded relation: "table (col1, col2)" or "alias:fk (col1, col2)"
      if (part.includes('(')) {
        // Extract the FK column: "alias:fk_col (...)" → fk_col
        const match = part.match(/^(\w+):(\w+)\s*\(/);
        if (match) {
          cleaned.push(match[2]); // just the FK column
        }
        // "table (...)" with no colon — skip entirely (it's a join)
        continue;
      }
      // "alias:col" → "col as alias" (but often alias IS the col)
      if (part.includes(':')) {
        const [alias, col] = part.split(':').map(s => s.trim());
        cleaned.push(col);
      } else {
        cleaned.push(part);
      }
    }
    return cleaned.join(', ');
  }

  eq(col, val) {
    this._filters.push({ col, op: '=', val });
    return this;
  }

  neq(col, val) {
    this._neqFilters.push({ col, val });
    return this;
  }

  in(col, vals) {
    this._inFilters.push({ col, vals });
    return this;
  }

  not(col, op, val) {
    this._notFilters.push({ col, op, val });
    return this;
  }

  overlaps(col, vals) {
    this._overlapsFilters.push({ col, vals });
    return this;
  }

  ilike(col, pattern) {
    this._ilike.push({ col, pattern });
    return this;
  }

  or(expr) {
    this._or = expr;
    return this;
  }

  gte(col, val) {
    this._gte.push({ col, val });
    return this;
  }

  lte(col, val) {
    this._lte.push({ col, val });
    return this;
  }

  is(col, val) {
    this._is.push({ col, val });
    return this;
  }

  range(from, to) {
    this._rangeFrom = from;
    this._rangeTo = to - from + 1; // Convert to offset/limit
    this._offsetVal = from;
    this._limitVal = to - from + 1;
    return this;
  }

  order(col, opts = {}) {
    this._orderBy = { col, ascending: opts.ascending !== false };
    return this;
  }

  limit(n) {
    this._limitVal = n;
    return this;
  }

  single() {
    this._single = true;
    this._limitVal = 1;
    return this;
  }

  insert(data) {
    this._insertData = Array.isArray(data) ? data : [data];
    return this;
  }

  upsert(data, opts = {}) {
    this._insertData = Array.isArray(data) ? data : [data];
    this._upsertMode = true;
    this._upsertConflict = opts.onConflict || null;
    return this;
  }

  update(data) {
    this._updateData = data;
    return this;
  }

  delete() {
    this._deleteMode = true;
    return this;
  }

  async then(resolve, reject) {
    try {
      const result = await this._execute();
      resolve(result);
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }

  async _execute() {
    // Build raw SQL via the postgres.js client
    const sql = db;
    const table = this.tableName;

    try {
      if (this._insertData) {
        return await this._executeInsert(sql, table);
      }
      if (this._updateData) {
        return await this._executeUpdate(sql, table);
      }
      if (this._deleteMode) {
        return await this._executeDelete(sql, table);
      }
      return await this._executeSelect(sql, table);
    } catch (err) {
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  async _executeSelect(sql, table) {
    const params = [];
    const where = this._buildWhere(params);

    // Count mode with head: just return count
    if (this._countMode && this._headMode) {
      let countQuery = `SELECT COUNT(*)::int as count FROM "${table}"`;
      if (where) countQuery += ` WHERE ${where}`;
      const rows = await sql.unsafe(countQuery, params);
      const count = rows[0]?.count || 0;
      return { data: null, error: null, count };
    }

    // Count mode without head: return both data and count
    if (this._countMode) {
      // Get count first
      const countParams = [];
      const countWhere = this._buildWhere(countParams);
      let countQuery = `SELECT COUNT(*)::int as count FROM "${table}"`;
      if (countWhere) countQuery += ` WHERE ${countWhere}`;
      const countRows = await sql.unsafe(countQuery, countParams);
      const count = countRows[0]?.count || 0;

      // Then get data (fall through to normal select below, attach count)
      let dataQuery = `SELECT ${this._select === '*' ? '*' : this._select} FROM "${table}"`;
      if (where) dataQuery += ` WHERE ${where}`;
      if (this._orderBy) {
        dataQuery += ` ORDER BY "${this._orderBy.col}" ${this._orderBy.ascending ? 'ASC' : 'DESC'}`;
      }
      if (this._limitVal) dataQuery += ` LIMIT ${this._limitVal}`;
      if (this._offsetVal) dataQuery += ` OFFSET ${this._offsetVal}`;

      const rows = await sql.unsafe(dataQuery, params);
      return { data: rows, error: null, count };
    }

    let query = `SELECT ${this._select === '*' ? '*' : this._select} FROM "${table}"`;
    if (where) query += ` WHERE ${where}`;
    if (this._orderBy) {
      query += ` ORDER BY "${this._orderBy.col}" ${this._orderBy.ascending ? 'ASC' : 'DESC'}`;
    }
    if (this._limitVal) {
      query += ` LIMIT ${this._limitVal}`;
    }
    if (this._offsetVal) {
      query += ` OFFSET ${this._offsetVal}`;
    }

    const rows = await sql.unsafe(query, params);

    if (this._single) {
      if (rows.length === 0) {
        return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
      }
      return { data: rows[0], error: null };
    }

    return { data: rows, error: null };
  }

  async _executeInsert(sql, table) {
    const results = [];
    for (const row of this._insertData) {
      const cols = Object.keys(row);
      const vals = Object.values(row);
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      const colNames = cols.map(c => `"${c}"`).join(', ');

      let query;
      if (this._upsertMode) {
        const conflictCols = this._upsertConflict 
          ? this._upsertConflict.split(',').map(c => `"${c.trim()}"`).join(', ')
          : colNames; // default: all columns as conflict target
        const updateSet = cols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
        query = `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}`;
      } else {
        query = `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders})`;
      }

      if (this._returning) query += ' RETURNING *';

      const rows = await sql.unsafe(query, vals);
      results.push(...rows);
    }

    return { data: this._single ? results[0] || null : results, error: null };
  }

  async _executeUpdate(sql, table) {
    const setCols = Object.keys(this._updateData);
    const setVals = Object.values(this._updateData);
    const setClause = setCols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');

    const params = [...setVals];
    const where = this._buildWhere(params);

    let query = `UPDATE "${table}" SET ${setClause}`;
    if (where) query += ` WHERE ${where}`;
    if (this._returning) query += ` RETURNING *`;

    const rows = await sql.unsafe(query, params);

    if (this._single) {
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }

  async _executeDelete(sql, table) {
    const params = [];
    const where = this._buildWhere(params);

    let query = `DELETE FROM "${table}"`;
    if (where) query += ` WHERE ${where}`;

    await sql.unsafe(query, params);
    return { data: null, error: null };
  }

  _buildWhere(params) {
    const conditions = [];

    for (const f of this._filters) {
      params.push(f.val);
      conditions.push(`"${f.col}" = $${params.length}`);
    }

    for (const f of this._neqFilters) {
      params.push(f.val);
      conditions.push(`"${f.col}" != $${params.length}`);
    }

    for (const f of this._inFilters) {
      const placeholders = f.vals.map(v => { params.push(v); return `$${params.length}`; }).join(', ');
      conditions.push(`"${f.col}" IN (${placeholders})`);
    }

    for (const f of this._notFilters) {
      if (f.op === 'eq') {
        params.push(f.val);
        conditions.push(`"${f.col}" != $${params.length}`);
      }
    }

    for (const f of this._overlapsFilters) {
      params.push(f.vals);
      conditions.push(`"${f.col}" && $${params.length}`);
    }

    for (const f of this._ilike) {
      params.push(f.pattern);
      conditions.push(`"${f.col}" ILIKE $${params.length}`);
    }

    for (const f of this._gte) {
      params.push(f.val);
      conditions.push(`"${f.col}" >= $${params.length}`);
    }

    for (const f of this._lte) {
      params.push(f.val);
      conditions.push(`"${f.col}" <= $${params.length}`);
    }

    for (const f of this._is) {
      if (f.val === null) {
        conditions.push(`"${f.col}" IS NULL`);
      } else {
        params.push(f.val);
        conditions.push(`"${f.col}" IS $${params.length}`);
      }
    }

    if (this._or) {
      // Parse simple Supabase OR syntax: "col1.eq.val1,col2.eq.val2"
      const orParts = this._or.split(',').map(part => {
        const match = part.match(/^(\w+)\.(\w+)\.(.+)$/);
        if (match) {
          const [, col, op, val] = match;
          if (op === 'eq') {
            params.push(val);
            return `"${col}" = $${params.length}`;
          }
          if (op === 'ilike') {
            params.push(val);
            return `"${col}" ILIKE $${params.length}`;
          }
        }
        return null;
      }).filter(Boolean);
      if (orParts.length) {
        conditions.push(`(${orParts.join(' OR ')})`);
      }
    }

    return conditions.length ? conditions.join(' AND ') : '';
  }
}

// Compatibility API
const supabaseShim = {
  from(table) {
    return new QueryBuilder(table);
  },
  auth: {
    // Stubs — auth is handled by the v2 middleware
    getUser: async () => ({ data: null, error: { message: 'Use v2 auth' } }),
    setSession: async () => ({ data: null, error: { message: 'Use v2 auth' } }),
    getSession: async () => ({ data: null, error: { message: 'Use v2 auth' } }),
  },
  async rpc(fnName, params = {}) {
    // Handle common RPC functions
    try {
      if (fnName === 'search_plans' || fnName === 'search_nodes') {
        // Full-text search — simple ILIKE fallback
        const table = fnName === 'search_plans' ? 'plans' : 'plan_nodes';
        const query = params.search_query || params.query || '';
        const rows = await db.unsafe(
          `SELECT * FROM "${table}" WHERE title ILIKE $1 OR description ILIKE $1 LIMIT 20`,
          [`%${query}%`]
        );
        return { data: rows, error: null };
      }
      return { data: null, error: { message: `RPC function ${fnName} not implemented in shim` } };
    } catch (err) {
      return { data: null, error: { message: err.message } };
    }
  },
};

module.exports = {
  supabase: supabaseShim,
  supabaseAdmin: supabaseShim,
};
