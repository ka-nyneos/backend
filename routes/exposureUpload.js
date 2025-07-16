const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");

const exposureUploadController = require("../controllers/exposureUploadController");

const upload = multer({ dest: "uploads/" }); // For file uploads

// Routes
router.get("/userVars", exposureUploadController.getUserVars);
router.get("/renderVars", exposureUploadController.getRenderVars);
router.get("/pendingrenderVars", exposureUploadController.getPendingApprovalVars);
router.get("/userJourney", exposureUploadController.getUserJourney);
router.post("/bulkApprove", exposureUploadController.approveMultipleExposures);
router.post("/bulkReject", exposureUploadController.rejectMultipleExposures);
router.post("/deleteExposure", exposureUploadController.deleteExposure);
router.get("/netanalysis", exposureUploadController.getBuMaturityCurrencySummary);
// Upload CSV Route — note the controller function used
router.post("/upload-csv", upload.single("file"), exposureUploadController.uploadExposuresFromCSV);

// Uncomment if needed
// router.post("/approveExposure", exposureUploadController.approveExposure);
// router.post("/rejectExposure", exposureUploadController.rejectExposure);

module.exports = router;
