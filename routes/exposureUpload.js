const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");

const exposureUploadController = require("../controllers/exposureUploadController");

const upload = multer({ dest: "uploads/" }); 

router.get("/userVars", exposureUploadController.getUserVars);
router.get("/renderVars", exposureUploadController.getRenderVars);
router.get("/pendingrenderVars", exposureUploadController.getPendingApprovalVars);
router.get("/userJourney", exposureUploadController.getUserJourney);
router.post("/bulkApprove", exposureUploadController.approveMultipleExposures);
router.post("/bulkReject", exposureUploadController.rejectMultipleExposures);
router.post("/deleteExposure", exposureUploadController.deleteExposure);
router.get("/netanalysis", exposureUploadController.getBuMaturityCurrencySummary);
router.get("/top-currencies", exposureUploadController.getTopCurrencies);
router.get("/USDsum", exposureUploadController.getPoAmountUsdSum);
router.get("/payables", exposureUploadController.getPayablesByCurrency);
router.get("/receivables", exposureUploadController.getReceivablesByCurrency);
router.get(
  "/getpoAmountByCurrency",
  exposureUploadController.getAmountByCurrency
);

router.post("/upload-csv", upload.single("file"), exposureUploadController.uploadExposuresFromCSV);


module.exports = router;
