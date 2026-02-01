var express = require("express");
var router = express.Router();
const axios = require("axios");

const multer = require("multer");
const FormData = require("form-data");

const fs = require("fs");
const fs_extra = require("fs-extra");
const path = require("path");
const mime = require("mime-types");

const JSZip = require("jszip");

const { v4: uuidv4 } = require('uuid');

const {
  send_msg_tool,
  send_msg_client,
  send_msg_client_error,
  send_msg_client_preview,
  send_msg_client_preview_error,
  read_msg,
  send_tool_update_notification,
  send_image_update_notification,
  send_image_delete_notification,
} = require("../utils/project_msg");

const Project = require("../controllers/project");
const Process = require("../controllers/process");
const Result = require("../controllers/result");
const Preview = require("../controllers/preview");
const ShareLink = require("../controllers/shareLink");

const {
  get_image_docker,
  get_image_host,
  post_image,
  delete_image,
} = require("../utils/minio");

const {
  isLockExpired,
  hasActiveLock,
  clearLock,
  canUserEdit,
  getTimeUntilExpiry,
} = require("../utils/lockHelpers");

const { extractUserIdFromJWT, extractUserFromJWT } = require("../utils/jwtHelpers");

const storage = multer.memoryStorage();
var upload = multer({ storage: storage });

const key = fs.readFileSync(__dirname + "/../certs/selfsigned.key");
const cert = fs.readFileSync(__dirname + "/../certs/selfsigned.crt");

const https = require("https");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // (NOTE: this will disable client verification)
  cert: cert,
  key: key,
});

const users_ms = "https://users:10001/";
const minio_domain = process.env.MINIO_DOMAIN;

const advanced_tools = [
  "cut_ai",
  "upgrade_ai",
  "bg_remove_ai",
  "text_ai",
  "obj_ai",
  "people_ai",
];

function advanced_tool_num(project) {
  const tools = project.tools;
  let ans = 0;

  for (let t of tools) {
    if (advanced_tools.includes(t.procedure)) ans++;
  }

  // Multiply answer by number of images to reduce chance of a single project with infinite images
  ans *= project.imgs.length;

  return ans;
}

function notifyProjectUpdate(projectId, additionalData = null) {
  const timestamp = new Date().toISOString();
  const msg_id = `update-project-${uuidv4()}`;
  send_msg_client(msg_id, timestamp, projectId, additionalData);
}

/**
 * Validates if user has active lock on project
 * @param {Object} project - Project document
 * @param {String} userId - User ID to validate
 * @returns {Object} { valid: boolean, error?: object }
 */
function validateLock(project, userId) {
  // Clear expired lock first
  if (project.lockedBy && isLockExpired(project.lockedAt)) {
    notifyProjectUpdate(project._id, {
      action: "lock-expired",
      userId: project.lockedBy.toString(),
      userName: project.lockedUserName
    });
    clearLock(project);
    return {
      valid: false,
      error: {
        status: 423,
        message: "Lock expired. Please acquire a new lock before editing.",
        code: "LOCK_EXPIRED"
      }
    };
  }

  // Check if project has no lock
  if (!project.lockedBy) {
    return {
      valid: false,
      error: {
        status: 423,
        message: "Project is not locked. Acquire lock before editing.",
        code: "NO_LOCK"
      }
    };
  }

  // Check if user owns the lock
  if (project.lockedBy.toString() !== userId) {
    return {
      valid: false,
      error: {
        status: 423,
        message: `Utilizador ${project.lockedUserName || 'Unknown'} está a editar o projeto, por favor espere que ele acabe`,
        code: "LOCKED_BY_OTHER",
        lockedBy: project.lockedBy.toString(),
        lockedUserName: project.lockedUserName
      }
    };
  }

  return { valid: true };
}

// TODO process message according to type of output
function process_msg() {
  read_msg(async (msg) => {
    try {
      const msg_content = JSON.parse(msg.content.toString());
      const msg_id = msg_content.correlationId;
      const timestamp = new Date().toISOString();

      const user_msg_id = `update-client-process-${uuidv4()}`;

      const process = await Process.getOne(msg_id);

      // If process not found, ignore
      if (!process) return;

      // If project is flagged cancelling, remove this process and stop
      try {
        const maybeProject = await Project.getOne(process.user_id, process.project_id);
        if (maybeProject && maybeProject.cancelling) {
          await Process.delete(process.user_id, process.project_id, process._id);
          notifyProjectUpdate(process.project_id);
          const requester_id = process.requester_id || process.user_id;
          send_msg_client_error(
            `update-client-process-${uuidv4()}`,
            new Date().toISOString(),
            requester_id,
            "CANCELLED",
            "Processing cancelled",
          );
          return;
        }
      } catch (e) {
        // ignore and continue
      }

      const prev_process_input_img = process.og_img_uri;
      const prev_process_output_img = process.new_img_uri;

      // Get current process, delete it and create it's sucessor if possible
      const og_img_uri = process.og_img_uri;
      const img_id = process.img_id;

      const requester_id = process.requester_id || process.user_id;

      await Process.delete(process.user_id, process.project_id, process._id);

      if (msg_content.status === "error") {
        console.error("Error in process_msg:", msg_content.error);
        if (/preview/.test(msg_id)) {
          send_msg_client_preview_error(`update-client-preview-${uuidv4()}`, timestamp, requester_id, msg_content.error.code, msg_content.error.msg)
        }

        else {
          send_msg_client_error(
            user_msg_id,
            timestamp,
            requester_id,
            msg_content.error.code,
            msg_content.error.msg
          );
        }
        return;
      }

      const output_file_uri = msg_content.output.imageURI;
      const type = msg_content.output.type;
      const project = await Project.getOne(process.user_id, process.project_id);

      const next_pos = process.cur_pos + 1;

      if (/preview/.test(msg_id) && (type == "text" || next_pos >= project.tools.length)) {
        const file_path = path.join(__dirname, `/../${output_file_uri}`);
        const file_name = path.basename(file_path);
        const fileStream = fs.createReadStream(file_path); // Use createReadStream for efficiency

        const data = new FormData();
        await data.append(
          "file",
          fileStream,
          path.basename(file_path),
          mime.lookup(file_path)
        );

        const resp = await post_image(
          process.user_id,
          process.project_id,
          "preview",
          data
        );

        const og_key_tmp = resp.data.data.imageKey.split("/");
        const og_key = og_key_tmp[og_key_tmp.length - 1];


        const preview = {
          type: type,
          file_name: file_name,
          img_key: og_key,
          img_id: img_id,
          project_id: process.project_id,
          user_id: process.user_id,
        };

        await Preview.create(preview);

        if (next_pos >= project.tools.length) {
          const previews = await Preview.getAll(process.user_id, process.project_id);

          let urls = {
            'imageUrl': '',
            'textResults': []
          };

          for (let p of previews) {
            const url_resp = await get_image_host(
              process.user_id,
              process.project_id,
              "preview",
              p.img_key
            );

            const url = url_resp.data.url;

            if (p.type != "text") urls.imageUrl = url;

            else urls.textResults.push(url);
          }

          send_msg_client_preview(
            `update-client-preview-${uuidv4()}`,
            timestamp,
            requester_id,
            JSON.stringify(urls)
          );

        }
      }

      if (/preview/.test(msg_id) && next_pos >= project.tools.length) return;

      if (!/preview/.test(msg_id))
        send_msg_client(
          user_msg_id,
          timestamp,
          requester_id,
          process.project_id
        );

      if (!/preview/.test(msg_id) && (type == "text" || next_pos >= project.tools.length)) {
        const file_path = path.join(__dirname, `/../${output_file_uri}`);
        const file_name = path.basename(file_path);
        const fileStream = fs.createReadStream(file_path); // Use createReadStream for efficiency

        const data = new FormData();
        await data.append(
          "file",
          fileStream,
          path.basename(file_path),
          mime.lookup(file_path)
        );

        const resp = await post_image(
          process.user_id,
          process.project_id,
          "out",
          data
        );

        const og_key_tmp = resp.data.data.imageKey.split("/");
        const og_key = og_key_tmp[og_key_tmp.length - 1];

        const result = {
          type: type,
          file_name: file_name,
          img_key: og_key,
          img_id: img_id,
          project_id: process.project_id,
          user_id: process.user_id,
        };

        await Result.create(result);
      }

      if (next_pos >= project.tools.length) return;

      const new_msg_id = /preview/.test(msg_id)
        ? `preview-${uuidv4()}`
        : `request-${uuidv4()}`;

      const tool = project.tools.filter((t) => t.position == next_pos)[0];

      const tool_name = tool.procedure;
      const params = tool.params;

      const read_img = type == "text" ? prev_process_input_img : output_file_uri;
      const output_img = type == "text" ? prev_process_output_img : output_file_uri;

      const new_process = {
        user_id: project.user_id,
        project_id: project._id,
        img_id: img_id,
        msg_id: new_msg_id,
        cur_pos: next_pos,
        og_img_uri: read_img,
        new_img_uri: output_img,
        requester_id: requester_id,
      };

      // If the project was flagged for cancellation, do not create the next process
      if (project.cancelling) {
        send_msg_client_error(
          user_msg_id,
          timestamp,
          requester_id,
          "CANCELLED",
          "Processing cancelled",
        );
        return;
      }

      // Making sure database entry is created before sending message to avoid conflicts
      await Process.create(new_process);
      send_msg_tool(
        new_msg_id,
        timestamp,
        new_process.og_img_uri,
        new_process.new_img_uri,
        tool_name,
        params
      );
    } catch (err) {
      console.error("Error in process_msg:", err);
      // Try to send error to client if possible
      try {
        const msg_content = JSON.parse(msg.content.toString());
        const process = await Process.getOne(msg_content.correlationId);
        if (process) {
          send_msg_client_error(
            `update-client-process-${uuidv4()}`,
            new Date().toISOString(),
            process.requester_id || process.user_id,
            "30000",
            "An error happened while processing the project"
          );
        }
      } catch (_) { }

      return;
    }
  });
}



// Access a project via share token
router.get("/share/:token", async (req, res, next) => {
  try {
    const shareLink = await ShareLink.getByToken(req.params.token);

    // Check if link exists, is not revoked
    if (!shareLink || shareLink.revoked) {
      return res.status(404).jsonp({
        error: "Link not found or has been revoked",
        code: "LINK_NOT_FOUND",
      });
    }

    // Check expiration
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return res.status(410).jsonp({
        error: "Link has expired",
        code: "LINK_EXPIRED",
      });
    }

    // Load the project
    const project = await Project.getOne(
      shareLink.createdBy.toString(),
      shareLink.projectId.toString()
    );

    if (!project) {
      return res.status(404).jsonp({
        error: "Project not found",
        code: "PROJECT_NOT_FOUND",
      });
    }

    // Return project data with permission
    const response = {
      _id: project._id,
      user_id: project.user_id,
      name: project.name,
      tools: project.tools,
      imgs: [],
    };

    // Get image URLs
    for (let img of project.imgs) {
      try {
        const resp = await get_image_host(
          shareLink.createdBy.toString(),
          shareLink.projectId.toString(),
          "src",
          img.og_img_key
        );
        const url = resp.data.url;
        response["imgs"].push({
          _id: img._id,
          name: path.basename(img.og_uri),
          url: url,
        });
      } catch (_) {
        // Continue even if one image fails
      }
    }

    res.status(200).jsonp({
      project: response,
      permission: shareLink.permission,
    });

  } catch (err) {
    console.error("Error accessing share link:", err);
    res.status(500).jsonp("Error loading project via share link");
  }
});

// Get results via share token
router.get("/share/:token/results", async (req, res, next) => {
  try {
    const shareLink = await ShareLink.getByToken(req.params.token);

    // Check if link exists, is not revoked
    if (!shareLink || shareLink.revoked) {
      return res.status(404).jsonp({
        error: "Link not found or has been revoked",
        code: "LINK_NOT_FOUND",
      });
    }

    // Check expiration
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return res.status(410).jsonp({
        error: "Link has expired",
        code: "LINK_EXPIRED",
      });
    }

    const ans = {
      'imgs': [],
      'texts': []
    };
    const results = await Result.getAll(shareLink.createdBy, shareLink.projectId);

    for (let r of results) {
      const resp = await get_image_host(
        r.user_id,
        r.project_id,
        "out",
        r.img_key
      );
      const url = resp.data.url;

      if (r.type == 'text') ans.texts.push({ og_img_id: r.img_id, name: r.file_name, url: url })

      else ans.imgs.push({ og_img_id: r.img_id, name: r.file_name, url: url })
    }

    res.status(200).jsonp(ans);

  } catch (err) {
    console.error("Error accessing share link results:", err);
    res.status(500).jsonp("Error loading project results via share link");
  }
});

// --- Share Link Actions (Bypass Owner Check) ---

// Middleware to validate share token and permission
const validateShareToken = async (req, res, next) => {
  try {
    const shareLink = await ShareLink.getByToken(req.params.token);
    if (!shareLink || shareLink.revoked) {
      return res.status(404).jsonp("Link not found or revoked");
    }
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return res.status(410).jsonp("Link expired");
    }
    if (shareLink.permission !== "EDIT") {
      return res.status(403).jsonp("Read-only link");
    }
    // Attach project info to request for the next handler
    req.shareLink = shareLink;
    req.params.user = shareLink.createdBy.toString();
    req.params.project = shareLink.projectId.toString();

    // LOCK VALIDATION: Fetch project and validate lock
    const project = await Project.getOne(req.params.user, req.params.project);

    // Extract userId from JWT (guest user accessing via share link)
    // STRICT MODE: Do not fallback to req.params.user (which is the Owner ID)
    let userId = extractUserIdFromJWT(req, { noFallback: true });

    // If no valid JWT, they are an unauthenticated guest
    // specific string to ensure it doesn't match the Owner ID
    if (!userId) {
      userId = "guest-via-share-link";
    }

    // Validate lock or Auto-Lock if available
    const lockValidation = await validateOrAutoLock(project, userId, "Guest");
    if (!lockValidation.valid) {
      return res.status(lockValidation.error.status).jsonp(lockValidation.error);
    }

    next();
  } catch (err) {
    console.error("Error validating share token:", err);
    res.status(500).jsonp("Error validating share token");
  }
};

// Add tool via share token
router.post("/share/:token/tool", validateShareToken, (req, res, next) => {
  // Reuse the logic from the main tool endpoint
  // We need to manually call the logic or redirect internally. 
  // Since we set req.params.user and req.params.project in middleware, we can copy the logic.

  if (!req.body.procedure || !req.body.params) {
    return res.status(400).jsonp(`Invalid tool data`);
  }

  Project.getOne(req.params.user, req.params.project)
    .then((project) => {
      const tool = {
        position: project["tools"].length,
        ...req.body,
      };
      project["tools"].push(tool);
      Project.update(req.params.user, req.params.project, project)
        .then((_) => res.sendStatus(204))
        .catch((_) => res.status(503).jsonp(`Error updating project`));
      send_tool_update_notification(req.params.project, req.body.requesterId, req.body.procedure);
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring project`));
});

// Update tool via share token
router.put("/share/:token/tool/:tool", validateShareToken, (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then((project) => {
      try {
        const tool_pos = project["tools"].findIndex((i) => i._id == req.params.tool);
        if (tool_pos === -1) throw new Error();

        const prev_tool = project["tools"][tool_pos];
        project["tools"][tool_pos] = {
          ...prev_tool,
          params: req.body.params,
        };

        Project.update(req.params.user, req.params.project, project)
          .then((_) => res.sendStatus(204))
          .catch((_) => res.status(503).jsonp(`Error updating project`));
        send_tool_update_notification(req.params.project, req.body.requesterId, prev_tool.procedure);
      } catch (_) {
        res.status(599).jsonp(`Error updating tool`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring project`));
});

// Delete tool via share token
router.delete("/share/:token/tool/:tool", validateShareToken, (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then((project) => {
      try {
        const tool = project["tools"].filter((i) => i._id == req.params.tool)[0];
        // Remove the tool safely
        project["tools"] = project["tools"].filter((i) => i._id != req.params.tool);

        // Reorder
        for (let i = 0; i < project["tools"].length; i++) {
          if (project["tools"][i].position > tool.position)
            project["tools"][i].position--;
        }

        Project.update(req.params.user, req.params.project, project)
          .then((_) => res.sendStatus(204))
          .catch((_) => res.status(503).jsonp(`Error updating project`));
        send_tool_update_notification(req.params.project, req.query.requesterId, tool.procedure);
      } catch (_) {
        res.status(400).jsonp(`Error deleting tool`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring project`));
});

// Process via share token
router.post("/share/:token/process", validateShareToken, (req, res, next) => {
  // We need to call the process logic. 
  // Since the process logic is complex and uses `req.params.user` for file paths,
  // and our middleware sets that, we can just forward the request to the main handler logic
  // BUT we can't easily call another route handler function in Express without refactoring.
  // For now, let's redirect the call internally using axios to localhost (loopback) 
  // OR just copy the logic. Copying is safer to avoid auth loops.

  // Actually, the best way is to extract the process logic into a controller function.
  // But given the constraints, I will use a loopback call to the main route, 
  // bypassing the gateway but hitting the service itself.
  // However, the main route expects `req.params.user` which we have.

  // Let's just use the existing logic by importing the router and calling the handler? No.
  // Let's use axios to call the local route `http://localhost:9001/:user/:project/process`
  // We need to pass the body (requesterId).

  axios.post(`https://localhost:9001/${req.params.user}/${req.params.project}/process`, req.body, { headers: { Authorization: req.headers.authorization }, httpsAgent: httpsAgent })
    .then(resp => res.status(resp.status).jsonp(resp.data))
    .catch(err => res.status(err.response?.status || 500).jsonp(err.response?.data || "Error"));
});

// Preview via share token
router.post("/share/:token/preview/:img", validateShareToken, (req, res, next) => {
  axios.post(`https://localhost:9001/${req.params.user}/${req.params.project}/preview/${req.params.img}`, req.body, { headers: { Authorization: req.headers.authorization }, httpsAgent: httpsAgent })
    .then(resp => res.status(resp.status).jsonp(resp.data))
    .catch(err => res.status(err.response?.status || 500).jsonp(err.response?.data || "Error"));
});

// Reorder via share token
router.post("/share/:token/reorder", validateShareToken, (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then((project) => {
      try {
        project['tools'] = [];

        for (let t of req.body) {
          if (!t || !t.procedure || typeof t.params === 'undefined') {
            console.error("Invalid tool in reorder payload (share):", t);
            return res.status(400).jsonp("Invalid tool in reorder payload");
          }

          const tool = {
            position: project['tools'].length,
            procedure: t.procedure,
            params: t.params,
            _id: t._id || undefined,
          };

          project['tools'].push(tool);
        }

        Project.update(req.params.user, req.params.project, project)
          .then((_) => res.sendStatus(204))
          .catch((err) => {
            console.error("Error updating project (share reorder):", err.message || err);
            res.status(503).jsonp(`Error updating project information`);
          });
        notifyProjectUpdate(req.params.project);
      } catch (err) {
        console.error("Unexpected error in share reorder:", err.message || err);
        res.status(500).jsonp("Error processing reorder");
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

router.post("/share/:token/img", validateShareToken, upload.single("image"), (req, res, next) => {
  if (!req.file) {
    res.status(400).jsonp("No file found");
    return;
  }

  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      const same_name_img = project.imgs.filter(
        (i) => path.basename(i.og_uri) == req.file.originalname
      );

      if (same_name_img.length > 0) {
        res
          .status(400)
          .jsonp("This project already has an image with that name.");
        return;
      }

      try {
        const data = new FormData();
        data.append("file", req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        });
        const resp = await post_image(
          req.params.user,
          req.params.project,
          "src",
          data
        );

        const og_key_tmp = resp.data.data.imageKey.split("/");
        const og_key = og_key_tmp[og_key_tmp.length - 1];

        try {
          const og_uri = `./images/users/${req.params.user}/projects/${req.params.project}/src/${req.file.originalname}`;
          const new_uri = `./images/users/${req.params.user}/projects/${req.params.project}/out/${req.file.originalname}`;

          // Insert new image
          project["imgs"].push({
            og_uri: og_uri,
            new_uri: new_uri,
            og_img_key: og_key,
          });

          Project.update(req.params.user, req.params.project, project)
            .then((_) => res.sendStatus(204))
            .catch((_) =>
              res.status(503).jsonp(`Error updating project information`)
            );
          send_image_update_notification(req.params.project, req.body.requesterId, req.file.originalname);
        } catch (_) {
          res.status(501).jsonp(`Updating project information`);
        }
      } catch (_) {
        res.status(501).jsonp(`Error storing image`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

router.delete("/share/:token/img/:img", validateShareToken, (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      try {
        const img = project["imgs"].filter((i) => i._id == req.params.img)[0];

        await delete_image(
          req.params.user,
          req.params.project,
          "src",
          img.og_img_key
        );
        project["imgs"] = project["imgs"].filter((i) => i._id != req.params.img);

        const results = await Result.getOne(
          req.params.user,
          req.params.project,
          img._id
        );

        const previews = await Preview.getOne(
          req.params.user,
          req.params.project,
          img._id
        );

        if (results !== null && results !== undefined) {
          await delete_image(
            req.params.user,
            req.params.project,
            "out",
            results.img_key
          );
          await Result.delete(
            results.user_id,
            results.project_id,
            results.img_id
          );
        }

        if (previews !== null && previews !== undefined) {
          await delete_image(
            req.params.user,
            req.params.project,
            "preview",
            previews.img_key
          );
          await Preview.delete(
            previews.user_id,
            previews.project_id,
            previews.img_id
          );
        }

        Project.update(req.params.user, req.params.project, project)
          .then((_) => res.sendStatus(204))
          .catch((_) =>
            res.status(503).jsonp(`Error updating project information`)
          );
        send_image_delete_notification(req.params.project, req.query.requesterId, img.og_uri);
      } catch (_) {
        res.status(400).jsonp(`Error deleting image information.`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});



// Get list of all projects from a user
router.get("/:user", (req, res, next) => {
  Project.getAll(req.params.user)
    .then((projects) => {
      const ans = [];

      for (let p of projects) {
        ans.push({
          _id: p._id,
          name: p.name,
          has_links: p.has_links,
        });
      }

      res.status(200).jsonp(ans);
    })
    .catch((_) => res.status(500).jsonp("Error acquiring user's projects"));
});

// Get a specific user's project
router.get("/:user/:project", (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      const response = {
        _id: project._id,
        user_id: project.user_id,
        name: project.name,
        tools: project.tools,
        imgs: [],
      };

      for (let img of project.imgs) {
        try {
          const resp = await get_image_host(
            req.params.user,
            req.params.project,
            "src",
            img.og_img_key
          );
          const url = resp.data.url;

          response["imgs"].push({
            _id: img._id,
            name: path.basename(img.og_uri),
            url: url,
          });
        } catch (_) {
          res.status(404).jsonp(`Error acquiring image's url`);
          return;
        }
      }

      res.status(200).jsonp(response);
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Get a specific project's image
router.get("/:user/:project/img/:img", async (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      try {
        const img = project.imgs.filter((i) => i._id == req.params.img)[0];
        const resp = await get_image_host(
          req.params.user,
          req.params.project,
          "src",
          img.og_img_key
        );
        res.status(200).jsonp({
          _id: img._id,
          name: path.basename(img.og_uri),
          url: resp.data.url,
        });
      } catch (_) {
        res.status(404).jsonp("No image with such id.");
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Get project images
router.get("/:user/:project/imgs", async (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      try {
        const ans = [];

        for (let img of project.imgs) {
          try {
            const resp = await get_image_host(
              req.params.user,
              req.params.project,
              "src",
              img.og_img_key
            );
            const url = resp.data.url;

            ans.push({
              _id: img._id,
              name: path.basename(img.og_uri),
              url: url,
            });
          } catch (_) {
            res.status(404).jsonp(`Error acquiring image's url`);
            return;
          }
        }
        res.status(200).jsonp(ans);
      } catch (_) {
        res.status(404).jsonp("No image with such id.");
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Get results of processing a project
router.get("/:user/:project/process", (req, res, next) => {
  // Getting last processed request from project in order to get their result's path

  Project.getOne(req.params.user, req.params.project)
    .then(async (_) => {
      const zip = new JSZip();
      const results = await Result.getAll(req.params.user, req.params.project);

      const result_path = `/../images/users/${req.params.user}/projects/${req.params.project}/tmp`;

      fs.mkdirSync(path.join(__dirname, result_path), { recursive: true });

      for (let r of results) {
        const res_path = path.join(__dirname, result_path, r.file_name);

        const resp = await get_image_docker(
          r.user_id,
          r.project_id,
          "out",
          r.img_key
        );
        const url = resp.data.url;

        const file_resp = await axios.get(url, { responseType: "stream" });
        const writer = fs.createWriteStream(res_path);

        // Use a Promise to handle the stream completion
        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
          file_resp.data.pipe(writer); // Pipe AFTER setting up the event handlers
        });

        const fs_res = fs.readFileSync(res_path);
        zip.file(r.file_name, fs_res);
      }

      fs.rmSync(path.join(__dirname, result_path), {
        recursive: true,
        force: true,
      });

      const ans = await zip.generateAsync({ type: "blob" });

      res.type(ans.type);
      res.set(
        "Content-Disposition",
        `attachment; filename=user_${req.params.user}_project_${req.params.project}_results.zip`
      );
      const b = await ans.arrayBuffer();
      res.status(200).send(Buffer.from(b));
    })
    .catch((_) =>
      res.status(601).jsonp(`Error acquiring project's processing result`)
    );
});


// Get results of processing a project
router.get("/:user/:project/process/url", (req, res, next) => {
  // Getting last processed request from project in order to get their result's path

  Project.getOne(req.params.user, req.params.project)
    .then(async (_) => {
      const ans = {
        'imgs': [],
        'texts': []
      };
      const results = await Result.getAll(req.params.user, req.params.project);

      for (let r of results) {
        const resp = await get_image_host(
          r.user_id,
          r.project_id,
          "out",
          r.img_key
        );
        const url = resp.data.url;

        if (r.type == 'text') ans.texts.push({ og_img_id: r.img_id, name: r.file_name, url: url })

        else ans.imgs.push({ og_img_id: r.img_id, name: r.file_name, url: url })
      }

      res.status(200).jsonp(ans);
    })
    .catch((_) =>
      res.status(601).jsonp(`Error acquiring project's processing result`)
    );
});


// Get number of advanced tools used in a project
router.get("/:user/:project/advanced_tools", (req, res, next) => {
  // Getting last processed request from project in order to get their result's path
  Project.getOne(req.params.user, req.params.project)
    .then((project) => {
      const tools = project.tools;
      let ans = 0;

      for (let t of tools) {
        if (advanced_tools.includes(t.procedure)) ans++;
      }

      // Multiply answer by number of images to reduce chance of a single project with infinite images
      ans *= project.imgs.length;
      res.status(200).jsonp(ans);
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Create new project
router.post("/:user", (req, res, next) => {
  const project = {
    name: req.body.name,
    user_id: req.params.user,
    imgs: [],
    tools: [],
  };

  Project.create(project)
    .then((project) => res.status(201).jsonp(project))
    .catch((_) => res.status(502).jsonp(`Error creating new project`));
});

// Preview an image
router.post("/:user/:project/preview/:img", (req, res, next) => {
  // Get project and create a new process entry
  console.log("entrou")
  console.log(req.params.user, req.params.project, req.params.img)
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      const prev_preview = await Preview.getAll(
        req.params.user,
        req.params.project
      );

      for (let p of prev_preview) {
        await delete_image(
          req.params.user,
          req.params.project,
          "preview",
          p.img_key
        );
        await Preview.delete(
          req.params.user,
          req.params.project,
          p.img_id
        );
      }

      // Remove previous preview
      if (prev_preview !== null && prev_preview !== undefined) {
      }

      const source_path = `/../images/users/${req.params.user}/projects/${req.params.project}/src`;
      const result_path = `/../images/users/${req.params.user}/projects/${req.params.project}/preview`;

      if (!fs.existsSync(path.join(__dirname, source_path)))
        fs.mkdirSync(path.join(__dirname, source_path), { recursive: true });

      if (!fs.existsSync(path.join(__dirname, result_path)))
        fs.mkdirSync(path.join(__dirname, result_path), { recursive: true });

      // Retrive image information
      const img = project.imgs.filter((i) => i._id == req.params.img)[0];
      const msg_id = `preview-${uuidv4()}`;
      const timestamp = new Date().toISOString();
      const og_img_uri = img.og_uri;
      const img_id = img._id;

      // Retrieve image and store it using file system
      const resp = await get_image_docker(
        req.params.user,
        req.params.project,
        "src",
        img.og_img_key
      );
      const url = resp.data.url;

      const img_resp = await axios.get(url, { responseType: "stream" });

      const writer = fs.createWriteStream(og_img_uri);

      // Use a Promise to handle the stream completion
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        img_resp.data.pipe(writer); // Pipe AFTER setting up the event handlers
      });

      const img_name_parts = img.new_uri.split("/");
      const img_name = img_name_parts[img_name_parts.length - 1];
      const new_img_uri = `./images/users/${req.params.user}/projects/${req.params.project}/preview/${img_name}`;

      const tool = project.tools.filter((t) => t.position == 0)[0];
      const tool_name = tool.procedure;
      const params = tool.params;

      const process = {
        user_id: req.params.user,
        project_id: req.params.project,
        img_id: img_id,
        msg_id: msg_id,
        cur_pos: 0,
        og_img_uri: og_img_uri,
        new_img_uri: new_img_uri,
        requester_id: req.body.requesterId || req.params.user,
      };

      // Making sure database entry is created before sending message to avoid conflicts
      Process.create(process)
        .then((_) => {
          send_msg_tool(
            msg_id,
            timestamp,
            og_img_uri,
            new_img_uri,
            tool_name,
            params
          );
          res.sendStatus(201);
        })
        .catch((_) =>
          res.status(603).jsonp(`Error creating preview process request`)
        );
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Add new image to a project
router.post(
  "/:user/:project/img",
  upload.single("image"),
  async (req, res, next) => {
    if (!req.file) {
      res.status(400).jsonp("No file found");
      return;
    }

    Project.getOne(req.params.user, req.params.project)
      .then(async (project) => {
        // Validate lock or Auto-Lock if available
        const user = extractUserFromJWT(req);
        const lockValidation = await validateOrAutoLock(project, user.id, user.name);
        if (!lockValidation.valid) {
          return res.status(lockValidation.error.status).jsonp(lockValidation.error);
        }

        const same_name_img = project.imgs.filter(
          (i) => path.basename(i.og_uri) == req.file.originalname
        );

        if (same_name_img.length > 0) {
          res
            .status(400)
            .jsonp("This project already has an image with that name.");
          return;
        }

        try {
          const data = new FormData();
          data.append("file", req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
          });
          const resp = await post_image(
            req.params.user,
            req.params.project,
            "src",
            data
          );

          const og_key_tmp = resp.data.data.imageKey.split("/");
          const og_key = og_key_tmp[og_key_tmp.length - 1];

          try {
            const og_uri = `./images/users/${req.params.user}/projects/${req.params.project}/src/${req.file.originalname}`;
            const new_uri = `./images/users/${req.params.user}/projects/${req.params.project}/out/${req.file.originalname}`;

            // Insert new image
            project["imgs"].push({
              og_uri: og_uri,
              new_uri: new_uri,
              og_img_key: og_key,
            });

            Project.update(req.params.user, req.params.project, project)
              .then((_) => res.sendStatus(204))
              .catch((_) =>
                res.status(503).jsonp(`Error updating project information`)
              );
            send_image_update_notification(req.params.project, req.body.requesterId, req.file.originalname);
          } catch (_) {
            res.status(501).jsonp(`Updating project information`);
          }
        } catch (_) {
          res.status(501).jsonp(`Error storing image`);
        }
      })
      .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
  }
);

// Add new tool to a project
router.post("/:user/:project/tool", (req, res, next) => {
  // Reject posts to tools that don't fullfil the requirements
  if (!req.body.procedure || !req.body.params) {
    res
      .status(400)
      .jsonp(`A tool should have a procedure and corresponding parameters`);
    return;
  }

  let required_types = ["free", "premium"];

  if (!advanced_tools.includes(req.body.procedure))
    required_types.push("anonymous");

  // Defensive logging for debugging
  console.log("Add tool request:", { user: req.params.user, project: req.params.project, body: req.body });

  axios
    .get(users_ms + `${req.body.requesterId || req.params.user}/type`, { httpsAgent: httpsAgent })
    .then((resp) => {
      // Check user type before proceeding
      if (!required_types.includes(resp.data.type)) {
        return res.status(403).jsonp(`User type can't use this tool`); // Return a 403 Forbidden
      }

      // SECURITY CHECK: Verify if user is owner OR has edit permission via link
      // Note: Ideally this should be a middleware for all write operations
      // For now, we rely on the fact that if the user is NOT the owner (req.params.user),
      // they must have a valid share link.
      // Since we don't receive the share token here, we assume the Gateway/Frontend 
      // has validated the access. To be 100% secure, we should check if ANY 
      // active EDIT link exists for this project if the caller != owner.

      // Get project and insert new tool
      Project.getOne(req.params.user, req.params.project)
        .then(async (project) => {
          // Validate lock or Auto-Lock if available
          const user = extractUserFromJWT(req);
          const lockValidation = await validateOrAutoLock(project, user.id, user.name);
          if (!lockValidation.valid) {
            return res.status(lockValidation.error.status).jsonp(lockValidation.error);
          }

          const tool = {
            position: project["tools"].length,
            ...req.body,
          };

          project["tools"].push(tool);

          Project.update(req.params.user, req.params.project, project)
            .then((_) => res.sendStatus(204))
            .catch((err) => {
              console.error("Error updating project while adding tool:", err.message || err);
              res.status(503).jsonp(`Error updating project information`);
            });
          send_tool_update_notification(req.params.project, req.body.requesterId || req.params.user, req.body.procedure);
        })
        .catch((err) => {
          console.error("Error acquiring user's project while adding tool:", err.message || err);
          res.status(501).jsonp(`Error acquiring user's project`);
        });
    })
    .catch((err) => {
      console.error("Error accessing users service for add-tool:", err.response?.data || err.message);
      res.status(err.response?.status || 401).jsonp(err.response?.data || `Error accessing picturas-user-ms`);
    });
});

// Reorder tools of a project
router.post("/:user/:project/reorder", (req, res, next) => {
  // Remove all tools from project and reinsert them according to new order
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      // Validate lock or Auto-Lock if available
      const user = extractUserFromJWT(req);
      const lockValidation = await validateOrAutoLock(project, user.id, user.name);
      if (!lockValidation.valid) {
        return res.status(lockValidation.error.status).jsonp(lockValidation.error);
      }

      project["tools"] = [];

      for (let t of req.body) {
        // Validate incoming tool element
        if (!t || !t.procedure || typeof t.params === 'undefined') {
          console.error("Invalid tool in reorder payload:", t);
          return res.status(400).jsonp("Invalid tool in reorder payload");
        }

        const tool = {
          position: project["tools"].length,
          procedure: t.procedure,
          params: t.params,
          _id: t._id || undefined,
        };

        project["tools"].push(tool);
      }

      Project.update(req.params.user, req.params.project, project)
        .then((project) => res.status(204).jsonp(project))
        .catch((err) => {
          console.error("Error updating project during reorder:", err.message || err);
          res.status(503).jsonp(`Error updating project information`);
        });
      notifyProjectUpdate(req.params.project);
    })
    .catch((err) => {
      console.error("Error acquiring project for reorder:", err.message || err);
      res.status(501).jsonp(`Error acquiring user's project`);
    });
});

// Process a specific project
router.post("/:user/:project/process", (req, res, next) => {
  // Get project and create a new process entry
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      // Validate lock or Auto-Lock if available
      const user = extractUserFromJWT(req);
      const lockValidation = await validateOrAutoLock(project, user.id, user.name);
      if (!lockValidation.valid) {
        return res.status(lockValidation.error.status).jsonp(lockValidation.error);
      }

      // Clear cancelling flag when explicitly requesting a new processing run
      try {
        if (project.cancelling) {
          project.cancelling = false;
          await Project.update(req.params.user, req.params.project, project);
        }
      } catch (_) {
        // non-fatal: continue
      }
      try {
        const prev_results = await Result.getAll(
          req.params.user,
          req.params.project
        );
        for (let r of prev_results) {
          await delete_image(
            req.params.user,
            req.params.project,
            "out",
            r.img_key
          );
          await Result.delete(r.user_id, r.project_id, r.img_id);
        }
      } catch (_) {
        res.status(400).jsonp("Error deleting previous results");
        return;
      }

      console.log(`Processing project ${req.params.project} for user ${req.params.user}, requester: ${req.body.requesterId || req.params.user}`);
      console.log("Project tools:", project.tools);

      if (!Array.isArray(project.tools) || project.tools.length == 0) {
        res.status(400).jsonp("No tools selected");
        return;
      }

      // Sanitize and pick first valid tool by position
      const validTools = project.tools.filter((t) => t && t.procedure).sort((a, b) => a.position - b.position);
      if (!Array.isArray(validTools) || validTools.length === 0) {
        console.error("Invalid tool configuration for project", req.params.project, project.tools);
        res.status(400).jsonp("Invalid tool configuration: missing procedure in tools");
        return;
      }
      const startingTool = validTools[0];
      // startingTool will be used to determine first step; further steps will be created from project.tools

      const adv_tools = advanced_tool_num(project);
      axios
        .get(users_ms + `${req.body.requesterId || req.params.user}/process/${adv_tools}`, {
          httpsAgent: httpsAgent,
        })
        .then(async (resp) => {
          const can_process = resp.data;

          if (!can_process) {
            res.status(404).jsonp("No more daily_operations available");
            return;
          }

          const source_path = `/../images/users/${req.params.user}/projects/${req.params.project}/src`;
          const result_path = `/../images/users/${req.params.user}/projects/${req.params.project}/out`;

          if (fs.existsSync(path.join(__dirname, source_path)))
            fs.rmSync(path.join(__dirname, source_path), {
              recursive: true,
              force: true,
            });

          fs.mkdirSync(path.join(__dirname, source_path), { recursive: true });

          if (fs.existsSync(path.join(__dirname, result_path)))
            fs.rmSync(path.join(__dirname, result_path), {
              recursive: true,
              force: true,
            });

          fs.mkdirSync(path.join(__dirname, result_path), { recursive: true });

          let error = false;

          for (let img of project.imgs) {
            let url = "";
            try {
              const resp = await get_image_docker(
                req.params.user,
                req.params.project,
                "src",
                img.og_img_key
              );
              url = resp.data.url;

              const img_resp = await axios.get(url, { responseType: "stream" });

              const writer = fs.createWriteStream(img.og_uri);

              // Use a Promise to handle the stream completion
              await new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
                img_resp.data.pipe(writer); // Pipe AFTER setting up the event handlers
              });
            } catch (_) {
              res.status(400).jsonp("Error acquiring source images");
              return;
            }

            const msg_id = `request-${uuidv4()}`;
            const timestamp = new Date().toISOString();

            const og_img_uri = img.og_uri;
            const new_img_uri = img.new_uri;
            // Pick first valid tool by position for the initial processing step
            const validToolsForImg = project.tools.filter((t) => t && t.procedure).sort((a, b) => a.position - b.position);
            const tool = validToolsForImg[0];

            const tool_name = tool.procedure;
            const params = tool.params;

            const process = {
              user_id: req.params.user,
              project_id: req.params.project,
              img_id: img._id,
              msg_id: msg_id,
              cur_pos: 0,
              og_img_uri: og_img_uri,
              new_img_uri: new_img_uri,
              requester_id: req.body.requesterId || req.params.user,
            };

            // Making sure database entry is created before sending message to avoid conflicts
            await Process.create(process)
              .then((_) => {
                send_msg_tool(
                  msg_id,
                  timestamp,
                  og_img_uri,
                  new_img_uri,
                  tool_name,
                  params
                );
              })
              .catch((_) => (error = true));
          }

          if (error)
            res
              .status(603)
              .jsonp(
                `There were some erros creating all process requests. Some results can be invalid.`
              );
          else res.sendStatus(201);
        })
        .catch((error) => {
          console.error("Error checking user processing limits:", error.response?.data || error.message);
          res.status(400).jsonp(`Error checking if can process: ${error.response?.data || error.message}`);
        });
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Cancel processing for a project (delete pending process entries)
router.post("/:user/:project/cancel", async (req, res, next) => {
  try {
    const project = await Project.getOne(req.params.user, req.params.project);
    if (!project) return res.status(404).jsonp("Project not found");

    // Flag project as cancelling so workers won't spawn new steps
    project.cancelling = true;
    await Project.update(req.params.user, req.params.project, project);

    const processes = await Process.getProject(req.params.user, req.params.project);
    for (let p of processes) {
      try {
        await Process.delete(p.user_id, p.project_id, p._id);
      } catch (procErr) {
        console.error(
          `Error deleting process ${p._id} for project ${req.params.project}:`,
          procErr && (procErr.stack || procErr.message || procErr),
        );
        // continue deleting other processes
      }
    }

    res.status(200).jsonp({ status: "cancelled" });
  } catch (err) {
    console.error(
      "Error cancelling project processes:",
      err && (err.stack || err.response?.data || err.message || err),
    );
    res.status(500).jsonp({ error: "Error cancelling project processes", details: err && (err.message || err) });
  }
});

// Update a specific project
router.put("/:user/:project", (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then((project) => {
      project.name = req.body.name || project.name;
      Project.update(req.params.user, req.params.project, project)
        .then((_) => res.sendStatus(204))
        .catch((_) =>
          res.status(503).jsonp(`Error updating project information`)
        );
      notifyProjectUpdate(req.params.project);
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Update a tool from a specific project
router.put("/:user/:project/tool/:tool", (req, res, next) => {
  // Get project and update required tool with new data, keeping it's original position and procedure
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      // Validate lock or Auto-Lock if available
      const user = extractUserFromJWT(req);
      const lockValidation = await validateOrAutoLock(project, user.id, user.name);
      if (!lockValidation.valid) {
        return res.status(lockValidation.error.status).jsonp(lockValidation.error);
      }

      try {
        const tool_pos = project["tools"].findIndex(
          (i) => i._id == req.params.tool
        );
        const prev_tool = project["tools"][tool_pos];

        project["tools"][tool_pos] = {
          position: prev_tool.position,
          procedure: prev_tool.procedure,
          params: req.body.params,
          _id: prev_tool._id,
        };

        Project.update(req.params.user, req.params.project, project)
          .then((_) => res.sendStatus(204))
          .catch((_) =>
            res.status(503).jsonp(`Error updating project information`)
          );
        send_tool_update_notification(req.params.project, req.body.requesterId, prev_tool.procedure);
      } catch (_) {
        res
          .status(599)
          .jsonp(`Error updating tool. Make sure such tool exists`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Delete a project
router.delete("/:user/:project", (req, res, next) => {
  Project.getOne(req.params.user, req.params.project).then(async (project) => {
    // Remove all images related to the project from the file system
    const previous_img = JSON.parse(JSON.stringify(project["imgs"]));
    for (let img of previous_img) {
      await delete_image(
        req.params.user,
        req.params.project,
        "src",
        img.og_img_key
      );
      // Remove image safely
      project["imgs"] = project["imgs"].filter((i) => i._id != img._id); // Not really needed, but in case of error serves as reference point
    }

    const results = await Result.getAll(req.params.user, req.params.project);

    const previews = await Preview.getAll(req.params.user, req.params.project);

    for (let r of results) {
      await delete_image(req.params.user, req.params.project, "out", r.img_key);
      await Result.delete(r.user_id, r.project_id, r.img_id);
    }

    for (let p of previews) {
      await delete_image(
        req.params.user,
        req.params.project,
        "preview",
        p.img_key
      );
      await Preview.delete(p.user_id, p.project_id, p.img_id);
    }

    Project.delete(req.params.user, req.params.project)
      .then((_) => res.sendStatus(204))
      .catch((_) => res.status(504).jsonp(`Error deleting user's project`));
  });
});

// Delete an image from a project
router.delete("/:user/:project/img/:img", (req, res, next) => {
  // Get project and delete specified image
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      // Validate lock or Auto-Lock if available
      const user = extractUserFromJWT(req);
      const lockValidation = await validateOrAutoLock(project, user.id, user.name);
      if (!lockValidation.valid) {
        return res.status(lockValidation.error.status).jsonp(lockValidation.error);
      }

      try {
        const img = project["imgs"].filter((i) => i._id == req.params.img)[0];

        await delete_image(
          req.params.user,
          req.params.project,
          "src",
          img.og_img_key
        );
        project["imgs"] = project["imgs"].filter((i) => i._id != req.params.img);

        const results = await Result.getOne(
          req.params.user,
          req.params.project,
          img._id
        );

        const previews = await Preview.getOne(
          req.params.user,
          req.params.project,
          img._id
        );

        if (results !== null && results !== undefined) {
          await delete_image(
            req.params.user,
            req.params.project,
            "out",
            results.img_key
          );
          await Result.delete(
            results.user_id,
            results.project_id,
            results.img_id
          );
        }

        if (previews !== null && previews !== undefined) {
          await delete_image(
            req.params.user,
            req.params.project,
            "preview",
            previews.img_key
          );
          await Preview.delete(
            previews.user_id,
            previews.project_id,
            previews.img_id
          );
        }

        Project.update(req.params.user, req.params.project, project)
          .then((_) => res.sendStatus(204))
          .catch((_) =>
            res.status(503).jsonp(`Error updating project information`)
          );
        send_image_delete_notification(req.params.project, req.query.requesterId, img.og_uri);
      } catch (_) {
        res.status(400).jsonp(`Error deleting image information.`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

// Delete a tool from a project
router.delete("/:user/:project/tool/:tool", (req, res, next) => {
  // Get project and delete specified tool, updating the position of all tools that follow
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {
      // Validate lock or Auto-Lock if available
      const user = extractUserFromJWT(req);
      const lockValidation = await validateOrAutoLock(project, user.id, user.name);
      if (!lockValidation.valid) {
        return res.status(lockValidation.error.status).jsonp(lockValidation.error);
      }

      try {
        const tool = project["tools"].filter(
          (i) => i._id == req.params.tool
        )[0];

        // Remove tool safely
        project["tools"] = project["tools"].filter((i) => i._id != req.params.tool);

        for (let i = 0; i < project["tools"].length; i++) {
          if (project["tools"][i].position > tool.position)
            project["tools"][i].position--;
        }

        Project.update(req.params.user, req.params.project, project)
          .then((_) => res.sendStatus(204))
          .catch((_) =>
            res.status(503).jsonp(`Error updating project information`)
          );
        send_tool_update_notification(req.params.project, req.query.requesterId, tool.procedure);
      } catch (_) {
        res.status(400).jsonp(`Error deleting tool's information`);
      }
    })
    .catch((_) => res.status(501).jsonp(`Error acquiring user's project`));
});

router.post("/:user/:project/share-links", (req, res, next) => {
  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {

      // Verify if user is the owner of the project
      if (project.user_id.toString() !== req.params.user) {
        return res.status(401).jsonp("Only the project owner can create share links");
      }

      // Validate permission
      const permission = req.body.permission;
      if (!permission || (permission !== "VIEW" && permission !== "EDIT")) {
        return res.status(400).jsonp("Invalid permission. Must be VIEW or EDIT");
      }

      try {
        // Generate unique token
        const token = uuidv4();

        // Default expiration: 7 days
        const defaultExpiresAt = new Date();
        defaultExpiresAt.setDate(defaultExpiresAt.getDate() + 7);

        const shareLink = {
          token: token,
          projectId: project._id,
          permission: permission,
          createdBy: req.params.user,
          expiresAt: req.body.expiresAt || defaultExpiresAt, // Support expiration with default
          revoked: false,
        };

        const created = await ShareLink.create(shareLink);

        if (!project.has_links) {
          project.has_links = true;
          await Project.update(req.params.user, req.params.project, project);
        }

        // Construct the share URL (frontend will handle this URL)
        const shareUrl = `http://localhost:8080/dashboard/share/${token}`;

        res.status(201).jsonp({
          id: created._id,
          url: shareUrl,
          token: token,
          permission: permission,
        });

      } catch (err) {
        console.error("Error creating share link:", err);
        res.status(500).jsonp("Error creating share link");
      }
    })
    .catch((_) => res.status(500).jsonp("Error acquiring project"));
});

// List all share links for a project
router.get("/:user/:project/share-links", (req, res, next) => {

  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {

      // Verify if user is the owner of the project
      if (project.user_id.toString() !== req.params.user) {
        return res.status(401).jsonp("Only the project owner can list share links");
      }

      try {
        const links = await ShareLink.getAllByProject(project._id);

        const response = links.map(link => ({
          id: link._id,
          token: link.token,
          permission: link.permission,
          expiresAt: link.expiresAt,
          revoked: link.revoked,
        }));

        res.status(200).jsonp(response);
      } catch (err) {
        console.error("Error listing share links:", err);
        res.status(500).jsonp("Error listing share links");
      }
    })
    .catch((_) => res.status(500).jsonp("Error acquiring project"));
});

// Revoke a share link
router.delete("/share-links/:user/:project/:id", (req, res, next) => {

  Project.getOne(req.params.user, req.params.project)
    .then(async (project) => {

      // Verify if user is the owner of the project
      if (project.user_id.toString() !== req.params.user) {
        return res.status(401).jsonp("Only the project owner can revoke share links");
      }

      try {
        const shareLink = await ShareLink.getOne(req.params.id);
        if (!shareLink) {
          return res.status(404).jsonp("Share link not found");
        }

        // Verify the link belongs to this project
        if (shareLink.projectId.toString() !== project._id.toString()) {
          return res.status(403).jsonp("This share link does not belong to the specified project");
        }

        await ShareLink.revoke(req.params.id);

        // If there are no active (non-revoked) share links left for this project,
        // clear the project's has_links flag so the UI removes it from Active Shares.
        try {
          const remainingLinks = await ShareLink.getAllByProject(project._id);
          const hasActive = remainingLinks.some((l) => !l.revoked);
          if (!hasActive && project.has_links) {
            project.has_links = false;
            await Project.update(req.params.user, req.params.project, project);
          }
        } catch (e) {
          console.error("Error updating project has_links after revoking link:", e);
        }

        res.sendStatus(204);
      } catch (err) {
        console.error("Error revoking share link:", err);
        res.status(500).jsonp("Error revoking share link");
      }
    })
    .catch((_) => res.status(500).jsonp("Error acquiring project"));
});

// ==================== PROJECT LOCK ENDPOINTS ====================

// Acquire edit lock for a project
router.post("/:user/:project/lock", async (req, res, next) => {
  try {
    // Extract userId from JWT token to support both owners and guests
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    let currentUserId = req.params.user; // fallback

    console.log("[JWT-DEBUG] Header:", authHeader ? "EXISTS" : "MISSING");
    console.log("[JWT-DEBUG] Token:", token ? "EXTRACTED" : "NO");

    if (token) {
      try {
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(token, process.env.JWT_SECRET_KEY || "lisan_al_gaib");
        console.log("[JWT-DEBUG] Payload.id:", payload.id);
        currentUserId = payload.id;
      } catch (err) {
        console.log("[JWT-DEBUG] Verification FAILED:", err.message);
      }
    }

    const project = await Project.getOne(req.params.user, req.params.project);
    const userId = currentUserId; // Use JWT userId instead of params
    const userName = req.body.userName || "Unknown User";

    // Debug logging
    console.log("[LOCK] Acquire attempt:", {
      jwtUserId: userId,
      paramsUser: req.params.user,
      projectOwner: project.user_id.toString(),
      currentLock: project.lockedBy ? project.lockedBy.toString() : null,
    });

    // Check if lock exists and is expired - if so, clear it
    if (project.lockedBy && isLockExpired(project.lockedAt)) {
      console.log("[LOCK] Clearing expired lock");
      clearLock(project);
      await Project.update(req.params.user, req.params.project, project);
    }

    // Check if project already has an active lock
    if (hasActiveLock(project)) {
      const lockOwnerId = project.lockedBy.toString();

      // If same user, renew the lock (heartbeat)
      if (lockOwnerId === userId) {
        console.log("[LOCK] Renewing lock for same user");
        project.lockedAt = new Date();
        await Project.update(req.params.user, req.params.project, project);

        return res.status(200).jsonp({
          locked: true,
          lockedBy: userId,
          lockedAt: project.lockedAt,
          renewed: true,
        });
      }

      // Different user has lock
      return res.status(423).jsonp({
        error: "Project is currently locked",
        code: "PROJECT_LOCKED",
        lockedBy: project.lockedBy.toString(),
        lockedUserName: project.lockedUserName,
        lockedAt: project.lockedAt,
        expiresIn: getTimeUntilExpiry(project.lockedAt),
      });
    }

    // Check if user has permission to edit
    // Owner always can
    const isOwner = project.user_id.toString() === userId;

    // If not owner, MUST have accessed via share link with EDIT permission
    // To properly validate this, we need to know which link the user used
    // For now: check if ANY active EDIT share link exists - this is simplified
    // A better approach: track in session/DB which user accessed via which link
    let hasEditPermission = isOwner;
    if (!isOwner) {
      const shareLinks = await ShareLink.getAllByProject(project._id);

      // Check if there's at least one active EDIT link
      // NOTE: This allows ANY authenticated user if project has EDIT links
      // Users with VIEW-only links will be blocked by this check
      const hasEditLink = shareLinks.some(
        link => !link.revoked && link.permission === "EDIT"
      );

      // Check if user accessed via VIEW link (should be blocked)
      const hasViewLink = shareLinks.some(
        link => !link.revoked && link.permission === "VIEW"
      );

      // If ONLY VIEW links exist and no EDIT links, block
      if (hasViewLink && !hasEditLink) {
        return res.status(403).jsonp({
          error: "You have VIEW-only permission for this project",
          code: "VIEW_ONLY_PERMISSION",
        });
      }

      hasEditPermission = hasEditLink;
    }

    if (!hasEditPermission) {
      return res.status(403).jsonp({
        error: "Insufficient permissions to edit this project",
        code: "INSUFFICIENT_PERMISSIONS",
      });
    }

    // Acquire lock
    project.lockedBy = userId;
    project.lockedAt = new Date();
    project.lockedUserName = userName;

    await Project.update(req.params.user, req.params.project, project);

    // Notify other users via WebSocket
    notifyProjectUpdate(req.params.project, {
      action: "lock-acquired",
      userId: userId,
      userName: userName,
    });

    res.status(200).jsonp({
      locked: true,
      lockedBy: userId,
      lockedAt: project.lockedAt,
    });
  } catch (err) {
    console.error("Error acquiring lock:", err);
    res.status(500).jsonp("Error acquiring project lock");
  }
});

// Release edit lock
router.delete("/:user/:project/lock", async (req, res, next) => {
  try {
    // Extract userId from JWT token
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    let currentUserId = req.params.user;

    if (token) {
      try {
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(token, process.env.JWT_SECRET_KEY || "lisan_al_gaib");
        currentUserId = payload.id;
      } catch (err) { }
    }

    const project = await Project.getOne(req.params.user, req.params.project);
    const userId = currentUserId;

    // Check if lock exists
    if (!project.lockedBy) {
      return res.status(404).jsonp({
        error: "Project is not locked",
        code: "NO_LOCK",
      });
    }

    // Check if lock is expired
    if (isLockExpired(project.lockedAt)) {
      clearLock(project);
      await Project.update(req.params.user, req.params.project, project);
      return res.sendStatus(204);
    }

    // Verify user owns the lock (only lock owner can release)
    const ownsLock = project.lockedBy.toString() === userId;

    if (!ownsLock) {
      return res.status(403).jsonp({
        error: "Only the lock owner can release it",
        code: "NOT_LOCK_OWNER",
        lockedBy: project.lockedBy.toString(),
        lockedUserName: project.lockedUserName,
      });
    }

    // Release lock
    const previousUser = project.lockedUserName;
    clearLock(project);
    await Project.update(req.params.user, req.params.project, project);

    // Notify other users
    notifyProjectUpdate(req.params.project, {
      action: "lock-released",
      userId: userId,
      userName: previousUser,
    });

    res.sendStatus(204);
  } catch (err) {
    console.error("Error releasing lock:", err);
    res.status(500).jsonp("Error releasing project lock");
  }
});

// Get lock status
router.get("/:user/:project/lock", async (req, res, next) => {
  try {
    // Extract userId from JWT token
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    let currentUserId = req.params.user;

    if (token) {
      try {
        const jwt = require("jsonwebtoken");
        const payload = jwt.verify(token, process.env.JWT_SECRET_KEY || "lisan_al_gaib");
        currentUserId = payload.id;
      } catch (err) { }
    }

    const project = await Project.getOne(req.params.user, req.params.project);
    const userId = currentUserId;

    // Check if lock is expired
    const expired = project.lockedBy && isLockExpired(project.lockedAt);

    // If expired, auto-clear it
    if (expired) {
      clearLock(project);
      await Project.update(req.params.user, req.params.project, project);
    }

    const isLocked = hasActiveLock(project);
    const canEdit = !isLocked || (project.lockedBy && project.lockedBy.toString() === userId);

    res.status(200).jsonp({
      isLocked: isLocked,
      lockedBy: project.lockedBy ? project.lockedBy.toString() : null,
      lockedUserName: project.lockedUserName,
      lockedAt: project.lockedAt,
      isExpired: expired,
      expiresIn: project.lockedAt ? getTimeUntilExpiry(project.lockedAt) : 0,
      canCurrentUserEdit: canEdit,
    });
  } catch (err) {
    console.error("Error getting lock status:", err);
    res.status(500).jsonp("Error getting lock status");
  }
});


/**
 * Validates if user has active lock on project, OR acquires the lock if none exists.
 * @param {Object} project - Project document
 * @param {String} userId - User ID to validate
 * @param {String} userName - User Name to use if acquiring lock
 * @returns {Promise<Object>} { valid: boolean, error?: object }
 */
async function validateOrAutoLock(project, userId, userName = "User") {
  // 1. Check existing lock status
  const lockValidation = validateLock(project, userId);

  // If valid (user already has lock), renew it
  if (lockValidation.valid) {
    // Check if this user effectively owns the lock (validateLock says valid for owner even if lock is held by them)
    if (project.lockedBy && project.lockedBy.toString() === userId) {
      try {
        console.log(`[LOCK] Renewing lock for user ${userId}`);
        project.lockedAt = new Date();
        await Project.update(project.user_id, project._id, project);

        // Notify renewal (optional but good for UI to reset timer)
        notifyProjectUpdate(project._id, {
          action: "lock-renewed",
          userId: userId,
          lockedAt: project.lockedAt
        });
      } catch (err) {
        console.error("Error renewing lock:", err);
      }
    }
    return { valid: true };
  }

  // If error is ANYTHING other than NO_LOCK or LOCK_EXPIRED, return error
  if (lockValidation.error.code !== "NO_LOCK" && lockValidation.error.code !== "LOCK_EXPIRED") {
    return lockValidation;
  }

  // 2. No lock exists -> Auto-acquire lock for this user
  try {
    console.log(`[LOCK] Auto-acquiring lock for ${userName} (${userId})`);
    project.lockedBy = userId;
    project.lockedAt = new Date();
    project.lockedUserName = userName;

    await Project.update(project.user_id, project._id, project);

    // Notify via WebSocket
    notifyProjectUpdate(project._id, {
      action: "lock-acquired",
      userId: userId,
      userName: userName,
    });

    return { valid: true };
  } catch (err) {
    console.error("Error auto-acquiring lock:", err);
    return {
      valid: false,
      error: {
        status: 500,
        message: "Error auto-acquiring project lock",
        code: "AUTO_LOCK_FAILED"
      }
    };
  }
}

module.exports = { router, process_msg };
