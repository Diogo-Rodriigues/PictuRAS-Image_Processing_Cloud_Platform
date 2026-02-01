import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProject,
  addProjectImages,
  addProjectTool,
  clearProjectTools,
  deleteProject,
  deleteProjectImages,
  deleteProjectTool,
  downloadProjectImages,
  downloadProjectImage,
  downloadProjectResults,
  processProject,
  updateProject,
  updateProjectTool,
  previewProjectImage,
  inviteUser,
  fetchProjectByShareToken,
  shareProject,
  fetchProjectLinks,
  revokeProjectLink,
  reorderProjectTools,
  cancelProjectProcess,
} from "../projects";
import { createBlobUrlFromFile, downloadBlob } from "../utils";

export const useCancelProjectProcess = () => {
  return useMutation({
    mutationFn: cancelProjectProcess,
  });
};

export const useAddProject = (uid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addProject,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projects", uid, token],
      });
    },
  });
};

export const useProjectLinks = (uid: string, pid: string, token: string) => {
  return useQuery({
    queryKey: ["projectLinks", uid, pid, token],
    queryFn: () => fetchProjectLinks(uid, pid, token),
  });
};

export const useRevokeProjectLink = (
  uid: string,
  pid: string,
  token: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeProjectLink,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projectLinks", uid, pid, token] });
      // Invalidate projects list to update 'has_links' status if needed
      qc.invalidateQueries({ queryKey: ["projects", uid, token] });
    },
  });
};

export const useProjectByShareToken = (shareToken: string) => {
  return useQuery({
    queryKey: ["sharedProject", shareToken],
    queryFn: () => fetchProjectByShareToken(shareToken),
    enabled: !!shareToken,
  });
};

export const useInviteUser = (uid: string, pid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inviteUser,
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["project", uid, pid, token],
      });
    },
  });
};

export const useShareProject = (uid: string, pid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: shareProject,
    onSuccess: async () => {
      // Refresh project links and projects list so UI reflects new share link
      qc.invalidateQueries({ queryKey: ["projectLinks", uid, pid, token] });
      qc.invalidateQueries({ queryKey: ["projects", uid, token] });
      qc.invalidateQueries({ queryKey: ["project", uid, pid, token] });
      // Ensure immediate refetch of project links for the current project
      await qc.refetchQueries({ queryKey: ["projectLinks", uid, pid, token], exact: true });
    },
  });
};

export const useDeleteProject = (uid: string, pid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projects", uid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectImages", pid],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projectResults", uid, pid, token],
      });
    },
  });
};

export const useUpdateProject = (uid: string, pid: string, token: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateProject,
    onSuccess: () => {
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["projects", uid, token],
      });
      qc.invalidateQueries({
        refetchType: "all",
        queryKey: ["project", uid, pid, token],
      });
    },
  });
};

export const useAddProjectImages = (
  uid: string,
  pid: string,
  token: string,
  shareToken?: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: any) => addProjectImages({ ...vars, uid, pid, token, shareToken }),
    onSuccess: () => {
      if (shareToken) {
        qc.invalidateQueries({ queryKey: ["sharedProject", shareToken] });
      } else {
        qc.invalidateQueries({
          refetchType: "all",
          queryKey: ["project", uid, pid, token],
        });
        qc.invalidateQueries({
          refetchType: "all",
          queryKey: ["projectImages", uid, pid, token],
        });
      }
    },
  });
};

export const useDeleteProjectImages = (
  uid: string,
  pid: string,
  token: string,
  shareToken?: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: any) => deleteProjectImages({ ...vars, uid, pid, token, shareToken }),
    onSuccess: () => {
      if (shareToken) {
        qc.invalidateQueries({ queryKey: ["sharedProject", shareToken] });
      } else {
        qc.invalidateQueries({
          refetchType: "all",
          queryKey: ["project", uid, pid, token],
        });
        qc.invalidateQueries({
          refetchType: "all",
          queryKey: ["projectImages", uid, pid, token],
        });
      }
    },
  });
};

export const useDownloadProjectImage = (edited?: boolean) => {
  return useMutation({
    mutationFn: downloadProjectImage,
    onSuccess: async (image) => {
      const blobUrl = await createBlobUrlFromFile(image.file);
      downloadBlob(
        edited ? image.name.split(".")[0] + "_edited" : image.name,
        blobUrl,
      );
    },
  });
};

export const useDownloadProject = () => {
  return useMutation({
    mutationFn: downloadProjectImages,
    onSuccess: async (project) => {
      const blobUrl = await createBlobUrlFromFile(project.file);
      downloadBlob(project.name, blobUrl);
    },
  });
};

export const useDownloadProjectResults = () => {
  return useMutation({
    mutationFn: downloadProjectResults,
    onSuccess: async (project) => {
      const blobUrl = await createBlobUrlFromFile(project.file);
      downloadBlob(project.name + "_edited", blobUrl);
    },
  });
};

export const useProcessProject = () => {
  return useMutation({
    mutationFn: processProject,
  });
};

export const useAddProjectTool = (uid: string, pid: string, token: string, shareToken?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: any) => addProjectTool({ ...vars, uid, pid, token, shareToken }),
    onSuccess: async () => {
      if (shareToken) {
        qc.invalidateQueries({ queryKey: ["sharedProject", shareToken] });
        qc.invalidateQueries({ queryKey: ["sharedProjectResults", shareToken] });
        // Force immediate refetch so UI updates without full page reload
        await qc.refetchQueries({ queryKey: ["sharedProject", shareToken], exact: true });
      } else {
        qc.invalidateQueries({ queryKey: ["project", uid, pid, token]});
        qc.invalidateQueries({ queryKey: ["projectResults", uid, pid, token] });
        // Force immediate refetch so UI updates without full page reload
        await qc.refetchQueries({ queryKey: ["project", uid, pid, token], exact: true });
      }
    },
  });
};

export const usePreviewProjectResult = () => {
  return useMutation({
    mutationFn: previewProjectImage,
  });
};

export const useUpdateProjectTool = (
  uid: string,
  pid: string,
  token: string,
  shareToken?: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: any) => updateProjectTool({ ...vars, uid, pid, token, shareToken }),
    onSuccess: async () => {
      if (shareToken) {
        qc.invalidateQueries({ queryKey: ["sharedProject", shareToken] });
        qc.invalidateQueries({ queryKey: ["sharedProjectResults", shareToken] });
        await qc.refetchQueries({ queryKey: ["sharedProject", shareToken], exact: true });
      } else {
        qc.invalidateQueries({ queryKey: ["project", uid, pid, token]});
        qc.invalidateQueries({ queryKey: ["projectResults", uid, pid, token] });
        await qc.refetchQueries({ queryKey: ["project", uid, pid, token], exact: true });
      }
    },
  });
};

export const useDeleteProjectTool = (
  uid: string,
  pid: string,
  token: string,
  shareToken?: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: any) => deleteProjectTool({ ...vars, uid, pid, token, shareToken }),
    onSuccess: async () => {
      if (shareToken) {
        qc.invalidateQueries({ queryKey: ["sharedProject", shareToken] });
        qc.invalidateQueries({ queryKey: ["sharedProjectResults", shareToken] });
        await qc.refetchQueries({ queryKey: ["sharedProject", shareToken], exact: true });
      } else {
        qc.invalidateQueries({ queryKey: ["project", uid, pid, token]});
        qc.invalidateQueries({ queryKey: ["projectResults", uid, pid, token] });
        await qc.refetchQueries({ queryKey: ["project", uid, pid, token], exact: true });
      }
    },
  });
};

export const useClearProjectTools = (
  uid: string,
  pid: string,
  token: string,
  shareToken?: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: any) => clearProjectTools({ ...vars, uid, pid, token, shareToken }),
    onSuccess: () => {
      if (shareToken) {
        qc.invalidateQueries({ queryKey: ["sharedProject", shareToken] });
        qc.invalidateQueries({ queryKey: ["sharedProjectResults", shareToken] });
      } else {
        qc.invalidateQueries({ queryKey: ["project", uid, pid, token]});
        qc.invalidateQueries({ queryKey: ["projectResults", uid, pid, token] });
      }
    },
  });
};

export const useReorderProjectTools = (
  uid: string,
  pid: string,
  token: string,
  shareToken?: string,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: any) => reorderProjectTools({ ...vars, uid, pid, token, shareToken }),
    onSuccess: async () => {
      if (shareToken) {
        qc.invalidateQueries({ queryKey: ["sharedProject", shareToken] });
        qc.invalidateQueries({ queryKey: ["sharedProjectResults", shareToken] });
        await qc.refetchQueries({ queryKey: ["sharedProject", shareToken], exact: true });
      } else {
        qc.invalidateQueries({ queryKey: ["project", uid, pid, token]});
        qc.invalidateQueries({ queryKey: ["projectResults", uid, pid, token] });
        await qc.refetchQueries({ queryKey: ["project", uid, pid, token], exact: true });
      }
    },
  });
};
