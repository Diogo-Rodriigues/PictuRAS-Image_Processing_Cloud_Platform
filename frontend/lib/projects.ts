import { api } from "./axios";
import axios from "axios";
import JSZip from "jszip";
import { ToolNames, ToolParams } from "./tool-types";

export interface Project {
  _id: string;
  user_id: string;
  name: string;
  has_links?: boolean;
}

export interface SingleProject {
  _id: string;
  user_id: string;
  name: string;
  permission: "read" | "write" | "owner";
  tools: ProjectToolResponse[];
  imgs: ProjectImage[];
  shareToken?: string;
}
export interface ProjectImage {
  _id: string;
  name: string;
  url: string;
}

export interface ProjectImageText {
  _id: string;
  name: string;
  text: string;
}

export interface ProjectTool {
  _id?: string;
  position: number;
  procedure: ToolNames;
  params: ToolParams;
}

export interface SharedLink {
  _id: string;
  token: string;
  permission: "read" | "write";
  expires_at?: string;
}

export interface ProjectToolResponse extends Omit<ProjectTool, "_id"> {
  _id: string;
}

export const cancelProjectProcess = async ({
  uid,
  pid,
  token,
}: {
  uid: string;
  pid: string;
  token: string;
}) => {
  const response = await api.post(
    `/projects/${uid}/${pid}/cancel`,
  	{},
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (response.status !== 200) throw new Error("Failed to cancel project process");
};

export const fetchProjects = async (uid: string, token: string) => {
  const response = await api.get<Project[]>(`/projects/${uid}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch projects");

  return response.data.map((p) => ({
    _id: p._id,
    user_id: p.user_id,
    name: p.name,
    has_links: p.has_links,
  })) as Project[];
};

export const fetchProject = async (uid: string, pid: string, token: string) => {
  const response = await api.get<SingleProject>(`/projects/${uid}/${pid}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch project");

  return {
    _id: response.data._id,
    user_id: response.data.user_id || uid,
    name: response.data.name,
    imgs: response.data.imgs,
    tools: response.data.tools,
    permission: response.data.permission || "owner",
  } as SingleProject;
};

export const fetchProjectByShareToken = async (shareToken: string) => {
  const response = await api.get<{ project: any; permission: string }>(
    `/projects/share/${shareToken}`,
  );

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch shared project");

  const p = response.data.project;
  return {
    _id: p._id,
    user_id: p.user_id,
    name: p.name,
    imgs: p.imgs,
    tools: p.tools,
    permission: response.data.permission === "VIEW" ? "read" : "write",
    shareToken: shareToken,
  } as SingleProject;
};

export const fetchSharedProjectResults = async (shareToken: string) => {
  const response = await api.get<{
    imgs: {
      og_img_id: string;
      name: string;
      url: string;
    }[];
    texts: {
      og_img_id: string;
      name: string;
      url: string;
    }[];
  }>(`/projects/share/${shareToken}/results`);

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch project results");

  const texts: ProjectImageText[] = [];
  for (const text of response.data.texts) {
    const response = await axios.get<string>(text.url, {
      responseType: "text",
    });

    if (response.status !== 200 || !response.data)
      throw new Error("Failed to fetch text");

    texts.push({
      _id: text.og_img_id,
      name: text.name,
      text: response.data,
    });
  }

  return {
    imgs: response.data.imgs.map(
      (img) =>
        ({
          _id: img.og_img_id,
          name: img.name,
          url: img.url,
        }) as ProjectImage,
    ),
    texts: texts,
  };
};

export const addProject = async ({
  uid,
  token,
  name,
  images = [],
  requesterId,
}: {
  uid: string;
  token: string;
  name: string;
  images?: File[];
  requesterId?: string;
}) => {
  const response = await api.post<SingleProject>(
    `/projects/${uid}`,
    {
      name,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 201 || !response.data)
    throw new Error("Failed to create project");

  if (images.length > 0) {
    const project = response.data;

    await addProjectImages({
      uid,
      pid: project._id,
      token,
      images,
      requesterId,
    });

    return response.data;
  }
};

export const deleteProject = async ({
  uid,
  pid,
  token,
}: {
  uid: string;
  pid: string;
  token: string;
}) => {
  const response = await api.delete(`/projects/${uid}/${pid}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status !== 204) throw new Error("Failed to delete project");
};

export const updateProject = async ({
  uid,
  pid,
  token,
  name,
}: {
  uid: string;
  pid: string;
  token: string;
  name: string;
}) => {
  const response = await api.put(
    `/projects/${uid}/${pid}`,
    { name },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 204) throw new Error("Failed to update project");
};

export const getProjectImages = async (
  uid: string,
  pid: string,
  token: string,
) => {
  const response = await api.get<ProjectImage[]>(
    `/projects/${uid}/${pid}/imgs`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch project images");

  return response.data.map((img) => ({
    _id: img._id,
    name: img.name,
    url: img.url,
  })) as ProjectImage[];
};

export const getProjectImage = async (
  uid: string,
  pid: string,
  imageId: string,
  token: string,
) => {
  const response = await api.get<ProjectImage>(
    `/projects/${uid}/${pid}/img/${imageId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch project image");

  return {
    _id: response.data._id,
    name: response.data.name,
    url: response.data.url,
  } as ProjectImage;
};

export const downloadProjectImage = async ({
  imageUrl,
  imageName,
}: {
  imageUrl: string;
  imageName: string;
}) => {
  const response = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: "arraybuffer",
  });

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to download project image");

  const blob = new Blob([response.data], { type: "image/png" });
  const file = new File([blob], imageName, { type: "image/png" });

  return {
    name: imageName,
    file,
  };
};

export const downloadProjectImages = async ({
  uid,
  pid,
  token,
}: {
  uid: string;
  pid: string;
  token: string;
}) => {
  const project = await fetchProject(uid, pid, token);
  const zip = new JSZip();

  for (const image of project.imgs) {
    const { name, file } = await downloadProjectImage({
      imageUrl: image.url,
      imageName: image.name,
    });
    zip.file(name, file);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const file = new File([blob], `${project.name}.zip`, {
    type: "application/zip",
  });

  return {
    name: project.name,
    file,
  };
};

export const addProjectImages = async ({
  uid,
  pid,
  token,
  images,
  requesterId,
  shareToken,
}: {
  uid: string;
  pid: string;
  token: string;
  images: File[];
  requesterId?: string;
  shareToken?: string;
}) => {
  const url = shareToken
    ? `/projects/share/${shareToken}/img`
    : `/projects/${uid}/${pid}/img`;

  for (const image of images) {
    const formData = new FormData();
    formData.append("image", image);
    if (requesterId) {
      formData.append("requesterId", requesterId);
    }

    const response = await api.post(url, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Accept 200/201/204 as successful upload responses (gateway may translate status codes)
    if (![200, 201, 204].includes(response.status))
      throw new Error("Failed to upload image: " + image.name);
  }
};

export const deleteProjectImages = async ({
  uid,
  pid,
  token,
  imageIds,
  requesterId,
  shareToken,
}: {
  uid: string;
  pid: string;
  token: string;
  imageIds: string[];
  requesterId?: string;
  shareToken?: string;
}) => {
  for (const imageId of imageIds) {
    const url = shareToken
      ? `/projects/share/${shareToken}/img/${imageId}?requesterId=${requesterId}`
      : `/projects/${uid}/${pid}/img/${imageId}?requesterId=${requesterId}`;
    const response = await api.delete(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (response.status !== 204)
      throw new Error("Failed to delete image: " + imageId);
  }
};

export const previewProjectImage = async ({
  uid,
  pid,
  imageId,
  token,
  requesterId,
  shareToken,
}: {
  uid: string;
  pid: string;
  imageId: string;
  token: string;
  requesterId?: string;
  shareToken?: string;
}) => {
  const url = shareToken
    ? `/projects/share/${shareToken}/preview/${imageId}`
    : `/projects/${uid}/${pid}/preview/${imageId}`;

  const response = await api.post(
    url,
    { requesterId },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 201 || !response.data)
    throw new Error("Failed to request preview");
};

export const addProjectTool = async ({
  uid,
  pid,
  tool,
  token,
  shareToken,
  requesterId,
}: {
  uid: string;
  pid: string;
  tool: ProjectTool;
  token: string;
  shareToken?: string;
  requesterId?: string;
}) => {
  const url = shareToken
    ? `/projects/share/${shareToken}/tool`
    : `/projects/${uid}/${pid}/tool`;

  const response = await api.post(
    url,
    {
      ...tool,
      requesterId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  // Accept 200/201/204 as successful responses (API Gateway may translate status codes)
  if (![200, 201, 204].includes(response.status))
    throw new Error("Failed to add tool");
};

export const updateProjectTool = async ({
  uid,
  pid,
  toolId,
  toolParams,
  token,
  shareToken,
  requesterId,
}: {
  uid: string;
  pid: string;
  toolId: string;
  toolParams: ToolParams;
  token: string;
  shareToken?: string;
  requesterId?: string;
}) => {
  const url = shareToken
    ? `/projects/share/${shareToken}/tool/${toolId}`
    : `/projects/${uid}/${pid}/tool/${toolId}`;

  const response = await api.put(
    url,
    {
      params: toolParams,
      requesterId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 204) throw new Error("Failed to update tool");
};

export const deleteProjectTool = async ({
  uid,
  pid,
  toolId,
  token,
  shareToken,
  requesterId,
}: {
  uid: string;
  pid: string;
  toolId: string;
  token: string;
  shareToken?: string;
  requesterId?: string;
}) => {
  let url = shareToken
    ? `/projects/share/${shareToken}/tool/${toolId}`
    : `/projects/${uid}/${pid}/tool/${toolId}`;

  if (requesterId) {
    url += `?requesterId=${requesterId}`;
  }

  const response = await api.delete(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status !== 204) throw new Error("Failed to remove tool");
};

export const clearProjectTools = async ({
  uid,
  pid,
  token,
  toolIds,
  shareToken,
}: {
  uid: string;
  pid: string;
  token: string;
  toolIds: string[];
  shareToken?: string;
}) => {
  for (const toolId of toolIds) {
    await deleteProjectTool({ uid, pid, toolId, token, shareToken });
  }
};

export const reorderProjectTools = async ({
  uid,
  pid,
  token,
  shareToken,
  orders
}: {
  uid: string;
  pid: string;
  token: string;
  shareToken?: string;
  orders: { position: number }[];
}) => {
  const url = shareToken
    ? `projects/share/${shareToken}/reorder`
    : `projects/${uid}/${pid}/reorder`;

  console.log("REORDER THIS BITCH:", url, orders);

  const response = await api.post(
    url,
    orders,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  // Accept 200/201/204 as success (API Gateway may forward varying statuses)
  if (![200, 201, 204].includes(response.status)) throw new Error("Failed to update tool");
};

export const downloadProjectResults = async ({
  uid,
  pid,
  projectName,
  token,
}: {
  uid: string;
  pid: string;
  projectName: string;
  token: string;
}) => {
  const response = await api.get<ArrayBuffer>(
    `/projects/${uid}/${pid}/process`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "arraybuffer",
    },
  );

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to process project");

  const blob = new Blob([response.data], { type: "application/zip" });
  const file = new File([blob], projectName + "_edited.zip", {
    type: "application/zip",
  });

  return {
    name: projectName,
    file,
  };
};

export const fetchProjectResults = async (
  uid: string,
  pid: string,
  token: string,
) => {
  const response = await api.get<{
    imgs: {
      og_img_id: string;
      name: string;
      url: string;
    }[];
    texts: {
      og_img_id: string;
      name: string;
      url: string;
    }[];
  }>(`/projects/${uid}/${pid}/process/url`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch project results");

  const texts: ProjectImageText[] = [];
  for (const text of response.data.texts) {
    const response = await axios.get<string>(text.url, {
      responseType: "text",
    });

    if (response.status !== 200 || !response.data)
      throw new Error("Failed to fetch text");

    texts.push({
      _id: text.og_img_id,
      name: text.name,
      text: response.data,
    });
  }

  return {
    imgs: response.data.imgs.map(
      (img) =>
        ({
          _id: img.og_img_id,
          name: img.name,
          url: img.url,
        }) as ProjectImage,
    ),
    texts: texts,
  };
};

export const processProject = async ({
  uid,
  pid,
  token,
  requesterId,
  shareToken,
}: {
  uid: string;
  pid: string;
  token: string;
  requesterId?: string;
  shareToken?: string;
}) => {
  const url = shareToken
    ? `/projects/share/${shareToken}/process`
    : `/projects/${uid}/${pid}/process`;

  const response = await api.post<string>(
    url,
    { requesterId },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 201)
    throw new Error("Failed to request project processing");
};

export const inviteUser = async ({
  uid,
  pid,
  token,
  email,
  permission,
}: {
  uid: string;
  pid: string;
  token: string;
  email: string;
  permission: "read" | "write";
}) => {
  const response = await api.post(
    `/projects/${uid}/${pid}/invite`,
    { email, permission },
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (response.status !== 200 && response.status !== 201)
    throw new Error("Failed to invite user");
};

export const shareProject = async ({
  uid,
  pid,
  token,
  permission,
}: {
  uid: string;
  pid: string;
  token: string;
  permission: "read" | "write";
}) => {
  const response = await api.post<{ url: string }>(
    `/projects/${uid}/${pid}/share-links`,
    { permission: permission === "read" ? "VIEW" : "EDIT" },
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (response.status !== 200 && response.status !== 201)
    throw new Error("Failed to generate share link");

  return response.data;
};

export const fetchProjectLinks = async (
  uid: string,
  pid: string,
  token: string,
) => {
  const response = await api.get<any[]>(
    `/projects/${uid}/${pid}/share-links`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (response.status !== 200 || !response.data)
    throw new Error("Failed to fetch project links");

  return response.data
    .filter((link) => !link.revoked)
    .map((link) => ({
      _id: link.id,
      token: link.token || "HIDDEN",
      permission: link.permission === "VIEW" ? "read" : "write",
    })) as SharedLink[];
};

export const revokeProjectLink = async ({
  uid,
  pid,
  linkId,
  token,
}: {
  uid: string;
  pid: string;
  linkId: string;
  token: string;
}) => {
  const response = await api.delete(
    `/projects/share-links/${uid}/${pid}/${linkId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (response.status !== 200 && response.status !== 204)
    throw new Error("Failed to revoke link");
};
