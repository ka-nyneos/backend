const { pool } = require("../db");
const { v4: uuidv4 } = require("uuid");

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

exports.findParentAtLevel = async (req, res) => {
  try {
    const { level } = req.params;
    const numericLevel = parseInt(level, 10);
    if (isNaN(numericLevel) || numericLevel <= 1) {
      return res.json([]);
    }
    const parentLevel = numericLevel - 1;
    const result = await pool.query(
      "SELECT entity_name FROM masterEntity WHERE TRIM(BOTH ' ' FROM level) = $1 OR TRIM(BOTH ' ' FROM level) = $2",
      [parentLevel.toString(), `Level ${parentLevel}`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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

exports.deleteEntity = async (req, res) => {
  const { id } = req.params;
  const { comments } = req.body;
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Delete-Approval', comments = $2 WHERE entity_id = $1 RETURNING *`,
      [id, comments || null]
    );
    if (result.rowCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entity not found" });
    await pool.query(
      `UPDATE masterEntity SET approval_status = 'Delete-Approval', comments = $2 WHERE entity_id IN (
        SELECT child_entity_id FROM entityRelationships WHERE parent_entity_id = $1
      )`,
      [id, comments || null]
    );

    res.json({ success: true, entity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.approveEntity = async (req, res) => {
  const { id } = req.params;
  const { comments } = req.body;
  try {
    const current = await pool.query(
      `SELECT approval_status FROM masterEntity WHERE entity_id = $1`,
      [id]
    );
    if (current.rowCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entity not found" });
    const status = current.rows[0].approval_status;

    let result;
    if (status === "Delete-Approval") {
      result = await pool.query(
        `UPDATE masterEntity SET approval_status = 'Delete-Approved', is_deleted = true, comments = $2 WHERE entity_id = $1 RETURNING *`,
        [id, comments || null]
      );
      await pool.query(
        `UPDATE masterEntity SET approval_status = 'Delete-Approved', is_deleted = true, comments = $2 WHERE entity_id IN (
          SELECT child_entity_id FROM entityRelationships WHERE parent_entity_id = $1
        )`,
        [id, "Parent Deleted"]
      );
    } else {
      result = await pool.query(
        `UPDATE masterEntity SET approval_status = 'Approved', comments = $2 WHERE entity_id = $1 RETURNING *`,
        [id, comments || null]
      );
    }
    res.json({ success: true, entity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.rejectEntitiesBulk = async (req, res) => {
  const { entityIds, comments } = req.body;
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "entityIds array required" });
  }
  try {
    const result = await pool.query(
      `UPDATE masterEntity SET approval_status = 'Rejected', comments = $2 WHERE entity_id = ANY($1::text[]) RETURNING *`,
      [entityIds, comments || null]
    );
    await pool.query(
      `UPDATE masterEntity SET approval_status = 'Rejected', comments = $2 WHERE entity_id IN (
        SELECT child_entity_id FROM entityRelationships WHERE parent_entity_id = ANY($1::text[])
      )`,
      [entityIds, "Parent Rejected"]
    );
    res.json({ success: true, updated: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

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

exports.getAllEntityNames = async (req, res) => {
  try {
    const result = await pool.query("SELECT entity_name FROM masterEntity");
    res.json(result.rows.map((row) => row.entity_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
