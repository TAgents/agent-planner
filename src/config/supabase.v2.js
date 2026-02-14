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
  }

  select(fields) {
    this._select = fields || '*';
    this._returning = true;
    return this;
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
    let query = `SELECT ${this._select === '*' ? '*' : this._select} FROM "${table}"`;
    const params = [];
    const where = this._buildWhere(params);
    if (where) query += ` WHERE ${where}`;
    if (this._orderBy) {
      query += ` ORDER BY "${this._orderBy.col}" ${this._orderBy.ascending ? 'ASC' : 'DESC'}`;
    }
    if (this._limitVal) {
      query += ` LIMIT ${this._limitVal}`;
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

      const query = this._returning
        ? `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) RETURNING *`
        : `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders})`;

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
  },
};

module.exports = {
  supabase: supabaseShim,
  supabaseAdmin: supabaseShim,
};
