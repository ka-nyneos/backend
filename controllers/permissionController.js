const { pool } = require("../db");

exports.upsertRolePermissions = async (req, res) => {
  const { roleName, pages } = req.body;
  if (!roleName || !pages || typeof pages !== "object") {
    return res
      .status(400)
      .json({ success: false, error: "roleName and pages object required" });
  }
  try {
    const roleResult = await pool.query(
      "SELECT id FROM roles WHERE name = $1",
      [roleName]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Role not found" });
    }
    const role_id = roleResult.rows[0].id;

    const perms = [];
    for (const [page, tabs] of Object.entries(pages)) {
      for (const [tab, actions] of Object.entries(tabs)) {
        for (const [action, allowed] of Object.entries(actions)) {
          perms.push({ page, tab, action, allowed });
        }
      }
    }

    const results = [];
    for (const { page, tab, action, allowed } of perms) {
      let permResult = await pool.query(
        "SELECT id FROM permissions WHERE page_name = $1 AND tab_name = $2 AND action = $3",
        [page, tab, action]
      );
      let permission_id;
      if (permResult.rows.length === 0) {
        const insertPerm = await pool.query(
          "INSERT INTO permissions (page_name, tab_name, action) VALUES ($1, $2, $3) RETURNING id",
          [page, tab, action]
        );
        permission_id = insertPerm.rows[0].id;
      } else {
        permission_id = permResult.rows[0].id;
      }

      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id, allowed)
         VALUES ($1, $2, $3)
         ON CONFLICT (role_id, permission_id)
         DO UPDATE SET allowed = EXCLUDED.allowed`,
        [role_id, permission_id, allowed]
      );
      results.push({ page, tab, action, allowed });
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

function flattenPermissionsWithHasAccess(pages) {
  const perms = [];
  for (const [page, pageObj] of Object.entries(pages)) {
    if ("hasAccess" in pageObj) {
      perms.push({
        page,
        tab: null,
        action: "hasAccess",
        allowed: pageObj.hasAccess,
      });
    }
    for (const [tab, tabObj] of Object.entries(pageObj)) {
      if (tab === "hasAccess") continue;
      if ("hasAccess" in tabObj) {
        perms.push({
          page,
          tab,
          action: "hasAccess",
          allowed: tabObj.hasAccess,
        });
      }
      for (const [action, allowed] of Object.entries(tabObj)) {
        if (action === "hasAccess") continue;
        perms.push({ page, tab, action, allowed });
      }
    }
  }
  return perms;
}

exports.WithHasAccess = async (req, res) => {
  const { roleName, pages } = req.body;
  if (!roleName || !pages || typeof pages !== "object") {
    return res
      .status(400)
      .json({ success: false, error: "roleName and pages object required" });
  }
  try {
    const roleResult = await pool.query(
      "SELECT id FROM roles WHERE name = $1",
      [roleName]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Role not found" });
    }
    const role_id = roleResult.rows[0].id;
    const perms = flattenPermissionsWithHasAccess(pages);

    const results = [];
    for (const { page, tab, action, allowed } of perms) {
      let permResult = await pool.query(
        "SELECT id FROM permissions WHERE page_name = $1 AND tab_name = $2 AND action = $3",
        [page, tab, action]
      );
      let permission_id;
      if (permResult.rows.length === 0) {
        const insertPerm = await pool.query(
          "INSERT INTO permissions (page_name, tab_name, action) VALUES ($1, $2, $3) RETURNING id",
          [page, tab, action]
        );
        permission_id = insertPerm.rows[0].id;
      } else {
        permission_id = permResult.rows[0].id;
      }
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id, allowed)
         VALUES ($1, $2, $3)
         ON CONFLICT (role_id, permission_id)
         DO UPDATE SET allowed = EXCLUDED.allowed`,
        [role_id, permission_id, allowed]
      );
      results.push({ page, tab, action, allowed });
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/permissions/permissionjson
exports.getRolePermissionsJson = async (req, res) => {
  const { roleName } = req.body;
  if (!roleName) {
    return res.status(400).json({ success: false, error: "roleName required" });
  }
  try {
    const roleResult = await pool.query(
      "SELECT id FROM roles WHERE name = $1",
      [roleName]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Role not found" });
    }
    const role_id = roleResult.rows[0].id;

    // Only include permissions with status 'Approved' or 'approved'
    const permResult = await pool.query(
      `SELECT p.page_name, p.tab_name, p.action, rp.allowed
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       WHERE rp.role_id = $1 AND (rp.status = 'Approved' OR rp.status = 'approved')`,
      [role_id]
    );

    const pages = {};
    for (const row of permResult.rows) {
      const page = row.page_name;
      const tab = row.tab_name || "default";
      const action = row.action;
      const allowed = row.allowed;

      if (!pages[page]) pages[page] = {};
      if (action === "hasAccess" && tab === "default") {
        pages[page].hasAccess = allowed;
      } else {
        if (!pages[page][tab]) pages[page][tab] = {};
        pages[page][tab][action] = allowed;
      }
    }

    // Ensure every tab has a hasAccess property
    for (const page of Object.keys(pages)) {
      for (const tab of Object.keys(pages[page])) {
        if (tab !== "hasAccess" && !("hasAccess" in pages[page][tab])) {
          pages[page][tab].hasAccess = false;
        }
      }
    }

    res.json({ roleName, pages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update the status of all role permissions for a given roleName
// POST /api/permissions/update-role-permissions-status-by-name
// Body: { "roleName": "SomeRole", "status": "updated" }
exports.updateRolePermissionsStatusByName = async (req, res) => {
  const { roleName, status } = req.body;
  if (!roleName || !status) {
    return res
      .status(400)
      .json({ success: false, error: "roleName and status are required" });
  }
  try {
    // Get role_id from roles table using roleName
    const roleResult = await pool.query(
      "SELECT id FROM roles WHERE name = $1",
      [roleName]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Role not found" });
    }
    const roleId = roleResult.rows[0].id;

    // Update the status of all role permissions for the fetched roleId
    const updateResult = await pool.query(
      "UPDATE role_permissions SET status = $1 WHERE role_id = $2 RETURNING *",
      [status, roleId]
    );

    res.json({ success: true, updatedPermissions: updateResult.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Get distinct roleIds and their statuses, and map them to roleNames
// GET /api/permissions/roles-status
exports.getRolesStatus = async (req, res) => {
  try {
    // Fetch distinct roleIds and their statuses from role_permissions table
    const rolePermissionsResult = await pool.query(
      "SELECT DISTINCT role_id, status FROM role_permissions"
    );

    const rolesStatus = [];

    for (const row of rolePermissionsResult.rows) {
      const roleId = row.role_id;
      const status = row.status;

      // Fetch roleName for the roleId from roles table
      const roleResult = await pool.query(
        "SELECT name FROM roles WHERE id = $1",
        [roleId]
      );

      if (roleResult.rows.length > 0) {
        const roleName = roleResult.rows[0].name;
        rolesStatus.push({ roleName, status });
      }
    }

    res.json({ success: true, rolesStatus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
