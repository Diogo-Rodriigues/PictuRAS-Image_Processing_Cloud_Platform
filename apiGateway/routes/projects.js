var express = require("express");
var router = express.Router();

const axios = require("axios");

const https = require("https");
const fs = require("fs");

const multer = require("multer");
const FormData = require("form-data");

const auth = require("../auth/auth");

const key = fs.readFileSync(__dirname + "/../certs/selfsigned.key");
const cert = fs.readFileSync(__dirname + "/../certs/selfsigned.crt");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // (NOTE: this will disable client verification)
  cert: cert,
  key: key,
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const projectsURL = "https://projects:9001/";

// TODO Verify jwt

/*
Project structure
{
    "_id": Mongoose.type.id,
    "user_id": Mongoose.type.id,
    "name": String,
    "imgs": [Image Structure],
    "tools": [Tool Structure],
}

Image structure
{
    "_id": Mongoose.type.id,
    "og_uri": String,
    "new_uri": String
}

Tool structure
{
    "_id": Mongoose.type._id,
    "position": Number,
    "procedure": String,
    "params": Object
}

Post answer structure in case of success
{
    "acknowledged": Bool,
    "modifiedCount": Number,
    "upsertedId": null,
    "upsertedCount": Number,
    "matchedCount": Number
}
*/

/**
 * Note: auth.checkToken is a midleware used to verify JWT
 */

/**
 * Access a project via share token
 * @body Empty
 * @returns { "project": {...}, "permission": "VIEW" | "EDIT" }
 */
router.get("/share/:token", function (req, res, next) {
  // NOTE: This endpoint does NOT use auth.checkToken because it's accessible via public link
  // However, the frontend should still require the user to be logged in
  axios
    .get(projectsURL + `share/${req.params.token}`, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => {
      const status = err.response?.status || 500;
      const data = err.response?.data || "Error accessing share link";
      res.status(status).jsonp(data);
    });
});

/**
 * Get results via share token
 * @body Empty
 * @returns { "imgs": [...], "texts": [...] }
 */
router.get("/share/:token/results", function (req, res, next) {
  axios
    .get(projectsURL + `share/${req.params.token}/results`, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => {
      const status = err.response?.status || 500;
      const data = err.response?.data || "Error accessing share link results";
      res.status(status).jsonp(data);
    });
});

// --- Share Link Actions ---

router.post(
  "/share/:token/img",
  upload.single("image"),
  auth.verifyToken,
  function (req, res, next) {
    const data = new FormData();
    data.append("image", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    if (req.body.requesterId) {
      data.append("requesterId", req.body.requesterId);
    }

    axios
      .post(projectsURL + `share/${req.params.token}/img`, data, {
        headers: {
          "Content-Type": "multipart/form-data",
          "Authorization": req.headers.authorization
        },
        httpsAgent: httpsAgent,
      })
      .then((resp) => res.sendStatus(204))
      .catch((err) =>
        res
          .status(err.response?.status || 500)
          .jsonp(err.response?.data || "Error adding image to shared project")
      );
  }
);

router.delete(
  "/share/:token/img/:img",
  auth.verifyToken,
  function (req, res, next) {
    axios
      .delete(projectsURL + `share/${req.params.token}/img/${req.params.img}`, {
        httpsAgent: httpsAgent,
        headers: { 'Authorization': req.headers.authorization },
        params: req.query,
      })
      .then((_) => res.sendStatus(204))
      .catch((err) =>
        res
          .status(err.response?.status || 500)
          .jsonp(
            err.response?.data || "Error deleting image from shared project"
          )
      );
  }
);

router.post("/share/:token/tool", auth.verifyToken, function (req, res, next) {
  axios.post(projectsURL + `share/${req.params.token}/tool`, req.body, {
    httpsAgent,
    headers: { 'Authorization': req.headers.authorization }
  })
    .then(resp => res.status(201).jsonp(resp.data))
    .catch(err => res.status(err.response?.status || 500).jsonp(err.response?.data));
});

router.put("/share/:token/tool/:tool", auth.verifyToken, function (req, res, next) {
  axios.put(projectsURL + `share/${req.params.token}/tool/${req.params.tool}`, req.body, {
    httpsAgent,
    headers: { 'Authorization': req.headers.authorization }
  })
    .then(resp => res.sendStatus(204))
    .catch(err => res.status(err.response?.status || 500).jsonp(err.response?.data));
});

router.delete("/share/:token/tool/:tool", auth.verifyToken, function (req, res, next) {
  axios.delete(projectsURL + `share/${req.params.token}/tool/${req.params.tool}`, {
    httpsAgent,
    headers: { 'Authorization': req.headers.authorization }
  })
    .then(resp => res.sendStatus(204))
    .catch(err => res.status(err.response?.status || 500).jsonp(err.response?.data));
});

router.post("/share/:token/process", auth.verifyToken, function (req, res, next) {
  axios.post(projectsURL + `share/${req.params.token}/process`, req.body, {
    httpsAgent,
    headers: { 'Authorization': req.headers.authorization }
  })
    .then(resp => res.status(201).jsonp(resp.data))
    .catch(err => res.status(err.response?.status || 500).jsonp(err.response?.data));
});

router.post("/share/:token/preview/:img", auth.verifyToken, function (req, res, next) {
  axios.post(projectsURL + `share/${req.params.token}/preview/${req.params.img}`, req.body, {
    httpsAgent,
    headers: { 'Authorization': req.headers.authorization }
  })
    .then(resp => res.status(201).jsonp(resp.data))
    .catch(err => res.status(err.response?.status || 500).jsonp(err.response?.data));
});

// Reorder tools via share token
router.post("/share/:token/reorder", auth.verifyToken, function (req, res, next) {
  axios.post(projectsURL + `share/${req.params.token}/reorder`, req.body, {
    httpsAgent,
    headers: { 'Authorization': req.headers.authorization }
  })
    .then(resp => res.status(resp.status).jsonp(resp.data))
    .catch(err => {
      console.error("Error reordering tools via share token:", err.response?.data || err.message);
      res.status(err.response?.status || 500).jsonp(err.response?.data || "Error reordering shared tools");
    });
});

/**
 * Get user's projects
 * @body Empty
 * @returns List of projects, each project has no information about it's images or tools
 */
router.get("/:user", auth.checkToken, function (req, res, next) {
  axios
    .get(projectsURL + `${req.params.user}`, { httpsAgent: httpsAgent })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => res.status(500).jsonp("Error getting users"));
});

/**
 * Get user's project
 * @body Empty
 * @returns The required project
 */
router.get("/:user/:project", auth.checkToken, function (req, res, next) {
  axios
    .get(projectsURL + `${req.params.user}/${req.params.project}`, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => res.status(200).jsonp(resp.data))
    .catch((err) => res.status(500).jsonp("Error getting project"));
});

/**
 * Get project image
 * @body Empty
 * @returns The image url
 */
router.get(
  "/:user/:project/img/:img",
  auth.checkToken,
  function (req, res, next) {
    axios
      .get(
        projectsURL +
        `${req.params.user}/${req.params.project}/img/${req.params.img}`,
        {
          httpsAgent: httpsAgent,
        }
      )
      .then((resp) => {
        res.status(200).send(resp.data);
      })
      .catch((err) => res.status(500).jsonp("Error getting project image"));
  }
);

/**
 * Get project images
 * @body Empty
 * @returns The project's images
 */
router.get("/:user/:project/imgs", auth.checkToken, function (req, res, next) {
  axios
    .get(projectsURL + `${req.params.user}/${req.params.project}/imgs`, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => {
      res.status(200).send(resp.data);
    })
    .catch((err) => res.status(500).jsonp("Error getting project images"));
});

/**
 * Get project's processment result
 * @body Empty
 * @returns The required results, sent as a zip
 */
router.get(
  "/:user/:project/process",
  auth.checkToken,
  function (req, res, next) {
    axios
      .get(projectsURL + `${req.params.user}/${req.params.project}/process`, {
        httpsAgent: httpsAgent,
        responseType: "arraybuffer",
      })
      .then((resp) => res.status(200).send(resp.data))
      .catch((err) =>
        res.status(500).jsonp("Error getting processing results file")
      );
  }
);

/**
 * Get project's processment result
 * @body Empty
 * @returns The required results, sent as [{img_id, img_name, url}]
 */
router.get(
  "/:user/:project/process/url",
  auth.checkToken,
  function (req, res, next) {
    axios
      .get(
        projectsURL + `${req.params.user}/${req.params.project}/process/url`,
        {
          httpsAgent: httpsAgent,
        }
      )
      .then((resp) => {
        res.status(200).send(resp.data);
      })
      .catch((err) =>
        res.status(500).jsonp("Error getting processing results")
      );
  }
);

/**
 * Create new user's project
 * @body { "name": String }
 * @returns Created project's data
 */
router.post("/:user", auth.checkToken, function (req, res, next) {
  axios
    .post(projectsURL + `${req.params.user}`, req.body, {
      httpsAgent: httpsAgent,
    })
    .then((resp) => res.status(201).jsonp(resp.data))
    .catch((err) => res.status(500).jsonp("Error creating new project"));
});

/**
 * Preview an image
 * @body Empty
 * @returns String indication preview is being processed
 */
router.post(
  "/:user/:project/preview/:img",
  auth.checkToken,
  function (req, res, next) {
    axios
      .post(
        projectsURL +
        `${req.params.user}/${req.params.project}/preview/${req.params.img}`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(201).jsonp(resp.data))
      .catch((err) => {
        console.log(err);
        res.status(500).jsonp("Error requesting image preview");
      });
  }
);

/**
 * Add image to project
 * @body Empty
 * @file Image to be added
 * @returns Post answer structure in case of success
 */
router.post(
  "/:user/:project/img",
  upload.single("image"),
  auth.checkToken,
  function (req, res, next) {
    const data = new FormData();
    data.append("image", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    axios
      .post(
        projectsURL + `${req.params.user}/${req.params.project}/img`,
        data,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          httpsAgent: httpsAgent,
        }
      )
      .then((resp) => res.sendStatus(resp.status)) // Forward upstream status (e.g., 204)
      .catch((err) => {
        console.error("Error adding image to project:", err.response?.data || err.message);
        res.status(err.response?.status || 500).jsonp(err.response?.data || "Error adding image to project");
      });
  }
);

/**
 * Add tool to project
 * @body { "procedure": String, "params": Object }
 * @returns Post answer structure in case of success
 */
router.post("/:user/:project/tool", auth.checkToken, function (req, res, next) {
  console.log("Proxy add tool to projects service:", { user: req.params.user, project: req.params.project, body: req.body });
  axios
    .post(
      projectsURL + `${req.params.user}/${req.params.project}/tool`,
      req.body,
      { httpsAgent: httpsAgent }
    )
    .then((resp) => res.status(resp.status).jsonp(resp.data))
    .catch((err) => {
      console.error("Error adding tool to project:", err.response?.data || err.message);
      res.status(err.response?.status || 500).jsonp(err.response?.data || "Error adding tool to project");
    });
});

/**
 * Reorder tools of a project
 * @body [{ "position": Number, "procedure": String, "params": Object }] (Position is a unique number between 0 and req.body.length - 1)
 * @returns Post answer structure in case of success
 */
router.post(
  "/:user/:project/reorder",
  auth.checkToken,
  function (req, res, next) {
    axios
      .post(
        projectsURL + `${req.params.user}/${req.params.project}/reorder`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(resp.status).jsonp(resp.data))
      .catch((err) => {
        console.error("Error reordering tools:", err.response?.data || err.message);
        res.status(err.response?.status || 500).jsonp(err.response?.data || "Error reordering tools");
      });
  }
);

/**
 * Generate request to process a project
 * @body Empty
 * @returns String indicating process request has been created
 */
router.post(
  "/:user/:project/process",
  auth.checkToken,
  function (req, res, next) {
    axios
      .post(
        projectsURL + `${req.params.user}/${req.params.project}/process`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(201).jsonp(resp.data))
      .catch((err) => {
        console.error("Error requesting project processing:", err.response?.data || err.message);
        res.status(err.response?.status || 500).jsonp(err.response?.data || "Error requesting project processing");
      });
  }
);

// Cancel processing for a project (proxy to projects service)
router.post(
  "/:user/:project/cancel",
  auth.checkToken,
  function (req, res, next) {
    axios
      .post(
        projectsURL + `${req.params.user}/${req.params.project}/cancel`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(200).jsonp(resp.data))
      .catch((err) =>
        res.status(err.response?.status || 500).jsonp(err.response?.data)
      );
  }
);

/**
 * Update a specific project
 * @body { "name": String }
 * @returns Empty
 */
router.put("/:user/:project", auth.checkToken, function (req, res, next) {
  axios
    .put(projectsURL + `${req.params.user}/${req.params.project}`, req.body, {
      httpsAgent: httpsAgent,
    })
    .then((_) => res.sendStatus(204))
    .catch((err) => res.status(err.response?.status || 500).jsonp(err.response?.data || "Error updating project details"));
});

/**
 * Update a tool from a project
 * @body { "params" : Object }
 * @returns Empty
 */
router.put(
  "/:user/:project/tool/:tool",
  auth.checkToken,
  function (req, res, next) {
    axios
      .put(
        projectsURL +
        `${req.params.user}/${req.params.project}/tool/${req.params.tool}`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) => res.status(err.response?.status || 500).jsonp(err.response?.data || "Error updating tool params"));
  }
);

/**
 * Delete a user's project
 * @body Empty
 * @returns Empty
 */
router.delete("/:user/:project", auth.checkToken, function (req, res, next) {
  axios
    .delete(projectsURL + `${req.params.user}/${req.params.project}`, {
      httpsAgent: httpsAgent,
    })
    .then((_) => res.sendStatus(204))
    .catch((err) => res.status(err.response?.status || 500).jsonp(err.response?.data || "Error deleting project"));
});

/**
 * Remove an image from a user's project
 * @body Empty
 * @returns Empty
 */
router.delete(
  "/:user/:project/img/:img",
  auth.checkToken,
  function (req, res, next) {
    axios
      .delete(
        projectsURL +
        `${req.params.user}/${req.params.project}/img/${req.params.img}`,
        { httpsAgent: httpsAgent }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) =>
        res.status(err.response?.status || 500).jsonp(err.response?.data || "Error deleting image from project")
      );
  }
);

/**
 * Remove a tool from a user's project
 * @body Empty
 * @returns Empty
 */
router.delete(
  "/:user/:project/tool/:tool",
  auth.checkToken,
  function (req, res, next) {
    axios
      .delete(
        projectsURL +
        `${req.params.user}/${req.params.project}/tool/${req.params.tool}`,
        { httpsAgent: httpsAgent }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) =>
        res.status(err.response?.status || 500).jsonp(err.response?.data || "Error removing tool from project")
      );
  }
);

/**
 * Create a share link for a project
 * @body { "permission": "VIEW" | "EDIT" }
 * @returns { "id", "url", "token", "permission" }
 */
router.post(
  "/:user/:project/share-links",
  auth.checkToken,
  function (req, res, next) {
    axios
      .post(
        projectsURL + `${req.params.user}/${req.params.project}/share-links`,
        req.body,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(201).jsonp(resp.data))
      .catch((err) => {
        const status = err.response?.status || 500;
        const data = err.response?.data || "Error creating share link";
        res.status(status).jsonp(data);
      });
  }
);

/**
 * List all share links for a project
 * @body Empty
 * @returns [{ "id", "permission", "revoked" }]
 */
router.get(
  "/:user/:project/share-links",
  auth.checkToken,
  function (req, res, next) {
    axios
      .get(
        projectsURL + `${req.params.user}/${req.params.project}/share-links`,
        { httpsAgent: httpsAgent }
      )
      .then((resp) => res.status(200).jsonp(resp.data))
      .catch((err) => {
        const status = err.response?.status || 500;
        const data = err.response?.data || "Error listing share links";
        res.status(status).jsonp(data);
      });
  }
);

/**
 * Revoke a share link
 * @body Empty
 * @returns Empty
 */
router.delete(
  "/share-links/:user/:project/:id",
  auth.checkToken,
  function (req, res, next) {
    axios
      .delete(
        projectsURL +
        `share-links/${req.params.user}/${req.params.project}/${req.params.id}`,
        { httpsAgent: httpsAgent }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) => {
        const status = err.response?.status || 500;
        const data = err.response?.data || "Error revoking share link";
        res.status(status).jsonp(data);
      });
  }
);

/**
 * Acquire edit lock for a project
 * @body { "userName": "User Name" }
 * @returns { "locked", "lockedBy", "lockedAt" } or 423 if already locked
 */
router.post(
  "/:user/:project/lock",
  auth.verifyToken,  // Use verifyToken to allow any authenticated user
  function (req, res, next) {
    axios
      .post(
        projectsURL + `${req.params.user}/${req.params.project}/lock`,
        req.body,
        {
          httpsAgent: httpsAgent,
          headers: {
            'Authorization': req.headers.authorization  // Pass JWT to microservice
          }
        }
      )
      .then((resp) => res.status(200).jsonp(resp.data))
      .catch((err) => {
        const status = err.response?.status || 500;
        const data = err.response?.data || "Error acquiring lock";
        res.status(status).jsonp(data);
      });
  }
);

/**
 * Release edit lock
 * @body Empty
 * @returns 204 No Content
 */
router.delete(
  "/:user/:project/lock",
  auth.verifyToken,  // Use verifyToken to allow any authenticated user
  function (req, res, next) {
    axios
      .delete(
        projectsURL + `${req.params.user}/${req.params.project}/lock`,
        {
          httpsAgent: httpsAgent,
          headers: {
            'Authorization': req.headers.authorization  // Pass JWT to microservice
          }
        }
      )
      .then((_) => res.sendStatus(204))
      .catch((err) => {
        const status = err.response?.status || 500;
        const data = err.response?.data || "Error releasing lock";
        res.status(status).jsonp(data);
      });
  }
);

/**
 * Get lock status
 * @body Empty
 * @returns { "isLocked", "lockedBy", "lockedUserName", "canCurrentUserEdit", ... }
 */
router.get(
  "/:user/:project/lock",
  auth.verifyToken,  // Use verifyToken to allow any authenticated user
  function (req, res, next) {
    axios
      .get(
        projectsURL + `${req.params.user}/${req.params.project}/lock`,
        {
          httpsAgent: httpsAgent,
          headers: {
            'Authorization': req.headers.authorization  // Pass JWT to microservice
          }
        }
      )
      .then((resp) => res.status(200).jsonp(resp.data))
      .catch((err) => {
        const status = err.response?.status || 500;
        const data = err.response?.data || "Error getting lock status";
        res.status(status).jsonp(data);
      });
  }
);

module.exports = router;
