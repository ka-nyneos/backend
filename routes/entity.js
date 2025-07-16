const express = require("express");
const router = express.Router();
const entityController = require("../controllers/entityController");

router.post("/create", entityController.createEntity);

router.get("/entity/names", entityController.getAllEntityNames);

router.get("/findLevel/:id", entityController.findEntityLevel);
router.get("/findEntitiesAtLevel/:level", entityController.findEntitiesAtLevel); // new, for all entities at a level
router.get("/findParentAtLevel/:level", entityController.findParentAtLevel);
router.get("/findChildrenAtLevel/:level", entityController.findChildrenAtLevel); // children at a level (with relationship)
router.get("/findChildrenOfEntity/:id", entityController.findChildrenOfEntity);
router.post("/sync-relationships", entityController.syncRelationships); // fixed path
router.get("/hierarchy", entityController.getEntityHierarchy);

// Entity status update endpoints
router.post("/delete/:id", entityController.deleteEntity);
router.post("/approve/:id", entityController.approveEntity);
router.post("/reject/:id", entityController.rejectEntity);
router.post("/delete-bulk", entityController.deleteEntitiesBulk);
router.post("/approve-bulk", entityController.approveEntitiesBulk);
router.post("/reject-bulk", entityController.rejectEntitiesBulk);
router.post("/update/:id", entityController.updateEntity);

module.exports = router;
