const { pool } = require('../db');
const globalSession = require('../globalSession');
exports.createUser = async (req, res) => {
  const {
    authentication_type,
    employee_name,
    role, // e.g., "ADMIN", "SAKSHI"
    username_or_employee_id,
    email,
    mobile,
    address,
    business_unit_name,
    created_by,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Insert into users
    const userResult = await client.query(
      `INSERT INTO users (
        authentication_type,
        employee_name,
        username_or_employee_id,
        email,
        mobile,
        address,
        business_unit_name,
        status,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
      RETURNING id`,
      [
        authentication_type,
        employee_name,
        username_or_employee_id,
        email,
        mobile,
        address,
        business_unit_name,
        created_by,
      ]
    );

    const userId = userResult.rows[0].id;

    // Step 2: Fetch role_id from roles table
    const roleResult = await client.query(
      `SELECT id FROM roles WHERE name = $1 OR rolecode = $1`,
      [role]
    );

    if (roleResult.rows.length === 0) {
      throw new Error(`Role '${role}' not found in roles table`);
    }

    const roleId = roleResult.rows[0].id;

    // Step 3: Insert into user_roles
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
      [userId, roleId]
    );

    await client.query('COMMIT');

    res.status(201).json({ success: true, user_id: userId, role_id: roleId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

exports.getUsers = async (req, res) => {
  const { status } = req.query;
  try {
    // 1. Get current user session
    const session = globalSession.UserSessions[0];
    if (!session) {
      return res.status(404).json({ error: "No active session found" });
    }
    const userId = session.userId;
    // 2. Get user's business unit name
    const userResult = await pool.query(
      "SELECT business_unit_name FROM users WHERE id = $1",
      [userId]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }
    const userBu = userResult.rows[0].business_unit_name;
    if (!userBu) {
      return res.status(404).json({ error: "User has no business unit assigned" });
    }
    // 3. Find all descendant business units using recursive CTE
    const entityResult = await pool.query(
      "SELECT entity_id FROM masterEntity WHERE entity_name = $1 AND (approval_status = 'Approved' OR approval_status = 'approved') AND (is_deleted = false OR is_deleted IS NULL)",
      [userBu]
    );
    if (!entityResult.rows.length) {
      return res.status(404).json({ error: "Business unit entity not found" });
    }
    const rootEntityId = entityResult.rows[0].entity_id;
    const descendantsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT entity_id, entity_name FROM masterEntity WHERE entity_id = $1
        UNION ALL
        SELECT me.entity_id, me.entity_name
        FROM masterEntity me
        INNER JOIN entityRelationships er ON me.entity_id = er.child_entity_id
        INNER JOIN descendants d ON er.parent_entity_id = d.entity_id
        WHERE (me.approval_status = 'Approved' OR me.approval_status = 'approved') AND (me.is_deleted = false OR me.is_deleted IS NULL)
      )
      SELECT entity_name FROM descendants
    `, [rootEntityId]);
    const buNames = descendantsResult.rows.map(r => r.entity_name);
    if (!buNames.length) {
      return res.status(404).json({ error: "No accessible business units found" });
    }
    // 4. Query users in allowed business units
    let query = "SELECT * FROM users WHERE business_unit_name = ANY($1)";
    let params = [buNames];
    if (status) {
      query += " AND status = $2";
      params.push(status);
    }
    const result = await pool.query(query, params);
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// In controllers/userController.js
exports.updateUser = async (req, res) => {
  const toSnakeCase = (str) =>
    str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

  const keyMap = {
  username: "username_or_employee_id",
  createdDate: "created_at",
  createdBy: "created_by",
  businessUnitName: "business_unit_name",
  authenticationType: "authentication_type",
  employeeName: "employee_name",
  statusChangeRequest: null, 
  role: null, 
};



  const { id } = req.params;

  const originalFields = { ...req.body, status: "Awaiting-Approval" };

const fields = {};
for (const key in originalFields) {
  const mappedKey = keyMap[key];
  const finalKey = mappedKey === undefined ? key : mappedKey;
  const value = originalFields[key];

  if (value && typeof value === "object") continue;  
  if (finalKey === null) continue;                   

  fields[toSnakeCase(finalKey)] = value;
}


  const keys = Object.keys(fields);

  if (keys.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No fields to update" });
  }

  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => fields[k]);

  const query = `UPDATE users SET ${setClause} WHERE id = $${
    keys.length + 1
  } RETURNING *`;

  try {
    const result = await pool.query(query, [...values, id]);

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res
      .status(400)
      .json({ success: false, error: err.message || "Unknown error" });
  }
};




exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("UPDATE users SET status = 'Delete-Approval' WHERE id = $1 RETURNING *", [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.approveUser = async (req, res) => {
  const { id } = req.params;
  const { approved_by, approval_comment } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET status = 'Approved', approved_by = $1, approved_at = NOW(), approval_comment = $2 WHERE id = $3 RETURNING *`,
      [approved_by, approval_comment, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.rejectUser = async (req, res) => {
  const { id } = req.params;
  const { rejected_by, approval_comment } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET status = 'Rejected', rejected_by = $1, rejected_at = NOW(), approval_comment = $2 WHERE id = $3 RETURNING *`,
      [rejected_by, approval_comment, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getApprovedUsers = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE status = 'Approved' or status = 'approved'");
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAwaitingData = async (req, res) => {
  try {
    // 1. Get current user session
    const session = globalSession.UserSessions[0];
    if (!session) {
      return res.status(404).json({ error: "No active session found" });
    }
    const userId = session.userId;
    // 2. Get user's business unit name
    const userResult = await pool.query(
      "SELECT business_unit_name FROM users WHERE id = $1",
      [userId]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }
    const userBu = userResult.rows[0].business_unit_name;
    if (!userBu) {
      return res.status(404).json({ error: "User has no business unit assigned" });
    }
    // 3. Find all descendant business units using recursive CTE
    const entityResult = await pool.query(
      "SELECT entity_id FROM masterEntity WHERE entity_name = $1 AND (approval_status = 'Approved' OR approval_status = 'approved') AND (is_deleted = false OR is_deleted IS NULL)",
      [userBu]
    );
    if (!entityResult.rows.length) {
      return res.status(404).json({ error: "Business unit entity not found" });
    }
    const rootEntityId = entityResult.rows[0].entity_id;
    const descendantsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT entity_id, entity_name FROM masterEntity WHERE entity_id = $1
        UNION ALL
        SELECT me.entity_id, me.entity_name
        FROM masterEntity me
        INNER JOIN entityRelationships er ON me.entity_id = er.child_entity_id
        INNER JOIN descendants d ON er.parent_entity_id = d.entity_id
        WHERE (me.approval_status = 'Approved' OR me.approval_status = 'approved') AND (me.is_deleted = false OR me.is_deleted IS NULL)
      )
      SELECT entity_name FROM descendants
    `, [rootEntityId]);
    const buNames = descendantsResult.rows.map(r => r.entity_name);
    if (!buNames.length) {
      return res.status(404).json({ error: "No accessible business units found" });
    }
    // 4. Query users in allowed business units and awaiting statuses
    const result = await pool.query(
      "SELECT * FROM users WHERE business_unit_name = ANY($1) AND (status = 'pending' or status = 'Delete-Approval' or status = 'Awaiting-Approval' or status = 'delete-approval')",
      [buNames]
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
// exports.getPendingUsers = async (req, res) => {
//   try {
//     const result = await pool.query("SELECT * FROM users WHERE status = 'pending'");
//     res.json({ success: true, users: result.rows });
//   } catch (err) {
//     res.status(500).json({ success: false, error: err.message });
//   }
// }
exports.approveMultipleUsers = async (req, res) => {
  const { userIds, approved_by, approval_comment } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0 || !approved_by) {
    return res.status(400).json({ success: false, message: "userIds and approved_by are required" });
  }

  try {
    // Step 1: Fetch current statuses
    const { rows: existingUsers } = await pool.query(
      `SELECT id, status FROM users WHERE id = ANY($1::int[])`,
      [userIds]
    );

    const toDelete = existingUsers
      .filter(user => user.status === "Delete-Approval")
      .map(user => user.id);

    const toApprove = existingUsers
      .filter(user => user.status !== "Delete-Approval")
      .map(user => user.id);

    const results = {
      deleted: [],
      approved: [],
    };

    // Step 2: Delete users with "Delete-Approval"
    if (toDelete.length > 0) {
      const deleted = await pool.query(
        `DELETE FROM users WHERE id = ANY($1::int[]) RETURNING *`,
        [toDelete]
      );
      results.deleted = deleted.rows;
    }

    // Step 3: Approve remaining users
    if (toApprove.length > 0) {
      const approved = await pool.query(
        `UPDATE users 
         SET status = 'Approved', approved_by = $1, approved_at = NOW(), approval_comment = $2 
         WHERE id = ANY($3::int[]) 
         RETURNING *`,
        [approved_by, approval_comment || '', toApprove]
      );
      results.approved = approved.rows;
    }

    res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error("approveMultipleUsers error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};


exports.rejectMultipleUsers = async (req, res) => {
  const { userIds, rejected_by, rejection_comment } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0 || !rejected_by) {
    return res.status(400).json({ success: false, message: "userIds and rejected_by are required" });
  }

  try {
    const result = await pool.query(
      `UPDATE users 
       SET status = 'Rejected', approved_by = $1, approved_at = NOW(), approval_comment = $2 
       WHERE id = ANY($3::int[]) 
       RETURNING *`,
      [rejected_by, rejection_comment || '', userIds]
    );

    res.status(200).json({ success: true, updated: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
