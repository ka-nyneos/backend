
const globalSession = require("../globalSession");
const { pool } = require("../db");
const csv = require("csv-parser");
const path = require("path");
const fs = require("fs");

const getUserVars = async (req, res) => {
  const session = globalSession.UserSessions[0];

  if (!session) {
    return res.status(404).json({ error: "No active session found" });
  }

  const [firstName, ...restName] = session.name?.split(" ") || ["", ""];
  const secondName = restName.join(" ") || "";

  const loginDate = new Date(session.lastLoginTime || new Date());
  const dateLoggedIn = loginDate.toISOString().split("T")[0]; // "YYYY-MM-DD"
  const timeLoggedIn = loginDate.toTimeString().split(" ")[0]; // "HH:MM:SS"

  try {
    const query = "SELECT * FROM notifications WHERE user_id = $1";
    const result = await pool.query(query, [session.userId]);

    const messages = result.rows.map((row) => ({
      date: row.date,
      priority: row.priority,
      deadline: row.deadline,
      text: row.text,
    }));

    const userVars = {
      roleName: session.role,
      firstName,
      secondName,
      dateLoggedIn,
      timeLoggedIn,
      isLoggedIn: session.isLoggedIn,
      userEmailId: session.email,
      notification: {
        messages,
      },
    };

    res.json(userVars);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

const approveBucketing = async (req, res) => {
  const { exposureIds, approved_by, approval_comment } = req.body;
  console.log(exposureIds);

  if (!Array.isArray(exposureIds) || exposureIds.length === 0 || !approved_by) {
    return res.status(400).json({ success: false, message: "exposureIds and approved_by are required" });
  }

  try {
    // Fetch current statuses
    const { rows: existingExposures } = await pool.query(
      `SELECT id, status_bucketing FROM exposures WHERE id = ANY($1::uuid[])`,
      [exposureIds]
    );

    const toDelete = existingExposures
      .filter(row => row.status_bucketing === "Delete-Approval")
      .map(row => row.id);

    const toApprove = existingExposures
      .filter(row => row.status_bucketing  !== "Delete-Approval")
      .map(row => row.id);

    const results = {
      deleted: [],
      approved: [],
    };

    // Delete exposures
    if (toDelete.length > 0) {
      const deleted = await pool.query(
        `DELETE FROM exposures WHERE id = ANY($1::uuid[]) RETURNING *`,
        [toDelete]
      );
      results.deleted = deleted.rows;
    }

    // Approve remaining exposures
    if (toApprove.length > 0) {
      const approved = await pool.query(
        `UPDATE exposures
         SET status_bucketing = 'Approved'
         WHERE id = ANY($1::uuid[])
         RETURNING *`,
        [ toApprove]
      );
      results.approved = approved.rows;
    }

    res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error("approveMultipleExposures error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const rejectMultipleExposures = async (req, res) => {
  const { exposureIds, rejected_by, rejection_comment } = req.body;

  if (!Array.isArray(exposureIds) || exposureIds.length === 0 || !rejected_by) {
    return res.status(400).json({ success: false, message: "exposureIds and rejected_by are required" });
  }

  try {
    const { rows: existingExposures } = await pool.query(
      `SELECT id, status_bucketing FROM exposures WHERE id = ANY($1::uuid[])`,
      [exposureIds]
    );

    const toDelete = existingExposures
      .filter(row => row.status_bucketing  === "Delete-Approval")
      .map(row => row.id);

    const toReject = existingExposures
      .filter(row => row.status_bucketing !== "Delete-Approval")
      .map(row => row.id);

    const results = {
      deleted: [],
      rejected: [],
    };

    // Delete exposures
    if (toDelete.length > 0) {
      const deleted = await pool.query(
        `DELETE FROM exposures WHERE id = ANY($1::uuid[]) RETURNING *`,
        [toDelete]
      );
      results.deleted = deleted.rows;
    }

    // Reject remaining exposures
    if (toReject.length > 0) {
      const rejected = await pool.query(
        `UPDATE exposures
         SET status_bucketing = 'Rejected'
         WHERE id = ANY($1::uuid[])
         RETURNING *`,
        [toReject]
      );
      results.rejected = rejected.rows;
    }

    res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error("rejectMultipleExposures error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};


const getRenderVars = async (req, res) => {
  try {
    const exposuresResult = await pool.query(
      "SELECT * FROM exposures WHERE status_bucketing = 'approved' OR status_bucketing = 'Approved'"
    );

    const exposureIds = exposuresResult.rows.map((row) => row.id);

    if (exposureIds.length > 0) {
      await pool.query(
        `UPDATE exposures SET status_bucketing = 'Pending' WHERE id = ANY($1::uuid[])`,
        [exposureIds]
      );
    }

    const updatedRows = exposuresResult.rows.map((row) => ({
      ...row,
      status_bucketing: 'Pending',
    }));

    res.json({
      isLoadable: true,
      allExposuresTab: false,
      pendingApprovalTab: true,
      uploadingTab: false,
      btnApprove: false,
      buAccessible: ["Finance", "Sales"],
      pageData: updatedRows,
    });
  } catch (err) {
    console.error("Error fetching or updating exposures:", err);
    res.status(500).json({ error: "Failed to fetch exposures" });
  }
};


const getUserJourney = (req, res) => {
  res.json({
    process: "viewAllExposures",
    nextPageToCall: "exposure-Bucketing",
    actionCalledFrom: "submit",
  });
};



// In your Express route file
const getupdate = async (req, res) => {
  const { id } = req.params;
  const updatedFields = req.body;
  console.log("Updating exposure with ID:", id, "Fields:", updatedFields);

  if (!id || Object.keys(updatedFields).length === 0) {
    return res.status(400).json({ error: "Invalid ID or no fields to update" });
  }

  try {
    const setClause = Object.keys(updatedFields)
      .map((key, i) => `"${key}" = $${i + 1}`)
      .join(", ");

    const values = Object.values(updatedFields);

    const query = `UPDATE exposures SET ${setClause} WHERE reference_no = $${values.length + 1} RETURNING *`;
    const result = await pool.query(query, [...values, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Exposure not found" });
    }

    res.json({ success: true, updated: result.rows[0] });
  } catch (err) {
    console.error("Error updating exposure:", err);
    res.status(500).json({ error: "Failed to update exposure" });
  }
};


module.exports = {
  getUserVars,
  getRenderVars,
  getUserJourney,
  getupdate,
  approveBucketing,
  rejectMultipleExposures,
};
