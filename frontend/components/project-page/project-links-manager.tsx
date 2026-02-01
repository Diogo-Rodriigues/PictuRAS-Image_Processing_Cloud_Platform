"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Trash2, LoaderCircle, Copy, Check } from "lucide-react";
import { useProjectLinks, useRevokeProjectLink } from "@/lib/mutations/projects";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export function ProjectLinksManager({ pid }: { pid: string }) {
  const session = useSession();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const { data: links, isLoading } = useProjectLinks(
    session.user._id,
    pid,
    session.token
  );
  
  const revokeLink = useRevokeProjectLink(session.user._id, pid, session.token);

  function handleRevoke(linkId: string) {
    revokeLink.mutate(
      { uid: session.user._id, pid, linkId, token: session.token },
      {
        onSuccess: () => {
          toast({ title: "Link revoked successfully" });
        },
        onError: (err) => {
          toast({ 
            title: "Error revoking link", 
            description: err.message, 
            variant: "destructive" 
          });
        },
      }
    );
  }

  function handleCopy(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied to clipboard" });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <LoaderCircle className="animate-spin size-8" />
      </div>
    );
  }

  if (!links || links.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-full text-muted-foreground">
        <p>No active links for this project.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto w-full">
      <h2 className="text-2xl font-bold mb-4">Active Shared Links</h2>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Permission</TableHead>
              <TableHead>Link Token</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((link) => (
              <TableRow key={link._id}>
                <TableCell>
                  <Badge variant={link.permission === "write" ? "default" : "secondary"}>
                    {link.permission === "write" ? "Edit" : "Read Only"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground truncate max-w-[250px] block">
                      http://localhost:8080/dashboard/share/{link.token}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() =>
                        handleCopy(
                          `http://localhost:8080/dashboard/share/${link.token}`,
                          link._id
                        )
                      }
                    >
                      {copiedId === link._id ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </Button>
                    {link.expires_at && (
                      <span className="text-[10px] text-red-400 ml-2">Expires: {new Date(link.expires_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(link._id)}
                    disabled={revokeLink.isPending}
                    className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                  >
                    <Trash2 className="size-4 mr-2" /> Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}