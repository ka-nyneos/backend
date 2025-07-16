const { pool } = require("../db");
const { v4: uuidv4 } = require("uuid");
// Create a new entity (POST /api/entity/create)
exports.createEntity = async (req, res) => {
  const entity = req.body;
  try {
    const entityId = "E" + uuidv4().slice(0, 8).toUpperCase();
    const {
      entity_name,
      parentname = null,
      is_top_level_entity = false,
      address = null,
      contact_phone = null,
      contact_email = null,
      registration_number = null,
      pan_gst = null,
      legal_entity_identifier = null,
      tax_identification_number = null,
      default_currency = null,
      associated_business_units = null,
      reporting_currency = null,
      unique_identifier = null,
      legal_entity_type = null,
      fx_trading_authority = null,
      internal_fx_trading_limit = null,
      associated_treasury_contact = null,
      is_deleted = false,
      approval_status = "Pending",
      level = null,
    } = entity;
    await pool.query(
      `INSERT INTO masterEntity (
        entity_id, entity_name, parentName, is_top_level_entity,
        address, contact_phone, contact_email, registration_number,
        pan_gst, legal_entity_identifier, tax_identification_number,
        default_currency, associated_business_units, reporting_currency,
        unique_identifier, legal_entity_type, fx_trading_authority,
        internal_fx_trading_limit, associated_treasury_contact,
        is_deleted, approval_status, level
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )`,
      [
        entityId,
        entity_name,
        parentname,
        is_top_level_entity,
        address,
        contact_phone,
        contact_email,
        registration_number,
        pan_gst,
        legal_entity_identifier,
        tax_identification_number,
        default_currency,
        associated_business_units,
        reporting_currency,
        unique_identifier,
        legal_entity_type,
        fx_trading_authority,
        internal_fx_trading_limit,
        associated_treasury_contact,
        is_deleted,
        approval_status,
        level,
      ]
    );
    res.status(201).json({
      message: "Entity created successfully",
      entity_id: entityId,
      entity_name,
    });
  } catch (err) {
    console.error("❌ Error creating entity:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// Sync relationships (POST /api/entity/sync-relationships)
exports.syncRelationships = async (req, res) => {
  try {
    const allEntities = await pool.query(
      "SELECT entity_id, entity_name, parentName FROM masterEntity"
    );
    const nameToId = {};
    allEntities.rows.forEach(
      (row) => (nameToId[row.entity_name] = row.entity_id)
    );
    const inserted = [];
    for (const {
      entity_name,
      entity_id: childId,
      parentname,
    } of allEntities.rows) {
      if (!parentname || !nameToId[parentname]) continue;
      const parentId = nameToId[parentname];
      const existing = await pool.query(
        `SELECT 1 FROM entityRelationships WHERE parent_entity_id = $1 AND child_entity_id = $2`,
        [parentId, childId]
      );
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO entityRelationships (parent_entity_id, child_entity_id, status) VALUES ($1, $2, $3)`,
          [parentId, childId, "Active"]
        );
        inserted.push({ parentId, childId });
      }
    }
    res.status(200).json({
      message: "Relationships synced successfully",
      relationshipsAdded: inserted.length,
      details: inserted,
    });
  } catch (err) {
    console.error("❌ Error syncing relationships:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// Find entities at a level (GET /api/entity/findEntitiesAtLevel/:level)
exports.findEntitiesAtLevel = async (req, res) => {
  try {
    const { level } = req.params;
    const result = await pool.query(
      "SELECT parentname FROM masterEntity WHERE level = $1",
      [parntName]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Find parents at level (GET /api/entity/findParentAtLevel/:level)
exports.findParentAtLevel = async (req, res) => {
  try {
    const { level } = req.params;
    // Remove non-numeric characters and try to extract the number
    const numericLevel = parseInt(level, 10);
    if (isNaN(numericLevel) || numericLevel <= 1) {
      return res.json([]);
    }
    const parentLevel = numericLevel - 1;
    // Find all entities where level matches parentLevel (as string or number)
    const result = await pool.query(
      "SELECT entity_name FROM masterEntity WHERE TRIM(BOTH ' ' FROM level) = $1 OR TRIM(BOTH ' ' FROM level) = $2",
      [parentLevel.toString(), `Level ${parentLevel}`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Find children at level (GET /api/entity/findChildrenAtLevel/:level)
exports.findChildrenAtLevel = async (req, res) => {
  try {
    const { level } = req.params;
    const result = await pool.query(
      `SELECT me.*
       FROM masterEntity me
       JOIN entityRelationships er ON me.entity_id = er.child_entity_id
       WHERE me.level = $1`,
      [level]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Find children of an entity (GET /api/entity/findChildrenOfEntity/:id)
exports.findChildrenOfEntity = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT me.*
       FROM entityRelationships er
       JOIN masterEntity me ON er.child_entity_id = me.entity_id
       WHERE er.parent_entity_id = $1`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Find entity level (GET /api/entity/findLevel/:id)
exports.findEntityLevel = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT level FROM masterEntity WHERE entity_id = $1",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Entity not found" });
    }
    res.json({ level: result.rows[0].level });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get full entity hierarchy as nested JSON (GET /api/entity/hierarchy)
exports.getEntityHierarchy = async (req, res) => {
  try {
    const entitiesResult = await pool.query("SELECT * FROM masterEntity");
    const entities = entitiesResult.rows;
    const relResult = await pool.query("SELECT * FROM entityRelationships");
    const relationships = relResult.rows;
    const entityMap = {};
    entities.forEach((e) => {
      entityMap[e.entity_name] = {
        id: e.entity_id,
        name: e.entity_name,
        data: { ...e },
        children: [],
      };
    });
    relationships.forEach((rel) => {
      const parent = Object.values(entityMap).find(
        (e) => e.id === rel.parent_entity_id
      );
      const child = Object.values(entityMap).find(
        (e) => e.id === rel.child_entity_id
      );
      if (parent && child) {
        parent.children.push(child);
      }
    });
    const topLevel = entities
      .filter(
        (e) =>
          e.is_top_level_entity ||
          !relationships.some((rel) => rel.child_entity_id === e.entity_id)
      )
      .map((e) => entityMap[e.entity_name]);

    res.json(topLevel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Soft delete (mark for delete approval)
exports.deleteEntity = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Delete-Approval', is_deleted = true WHERE entity_id = $1 RETURNING *`,
      [id]
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entity not found" });
    res.json({ success: true, entity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Approve entity
exports.approveEntity = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Approved', is_deleted = false WHERE entity_id = $1 RETURNING *`,
      [id]
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entity not found" });
    res.json({ success: true, entity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Reject entity
exports.rejectEntity = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Rejected', is_deleted = true WHERE entity_id = $1 RETURNING *`,
      [id]
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entity not found" });
    res.json({ success: true, entity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Bulk delete
exports.deleteEntitiesBulk = async (req, res) => {
  const { entityIds } = req.body;
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "entityIds array required" });
  }
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Delete-Approval', is_deleted = true WHERE entity_id = ANY($1::text[]) RETURNING *`,
      [entityIds]
    );
    res.json({ success: true, updated: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Bulk approve
exports.approveEntitiesBulk = async (req, res) => {
  const { entityIds } = req.body;
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "entityIds array required" });
  }
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Approved', is_deleted = false WHERE entity_id = ANY($1::text[]) RETURNING *`,
      [entityIds]
    );
    res.json({ success: true, updated: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Bulk reject
exports.rejectEntitiesBulk = async (req, res) => {
  const { entityIds } = req.body;
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "entityIds array required" });
  }
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Rejected', is_deleted = true WHERE entity_id = ANY($1::text[]) RETURNING *`,
      [entityIds]
    );
    res.json({ success: true, updated: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update entity by id (PATCH /api/entity/update/:id)
exports.updateEntity = async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No fields to update" });
  }
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET ${setClause} WHERE entity_id = $${
        keys.length + 1
      } RETURNING *`,
      [...keys.map((k) => fields[k]), id]
    );
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Entity not found" });
    }
    res.json({ success: true, entity: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// Get all entity names (GET /api/entity/names)
exports.getAllEntityNames = async (req, res) => {
  try {
    const result = await pool.query("SELECT entity_name FROM masterEntity");
    res.json(result.rows.map((row) => row.entity_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

