"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoaderCircle, Share2, Copy, Check } from "lucide-react";
import { useShareProject } from "@/lib/mutations/projects";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

export function ShareProjectDialog() {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<"read" | "write">("read");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const { _id: pid } = useProjectInfo();
  const session = useSession();
  const shareProject = useShareProject(
    session.user._id,
    pid as string,
    session.token,
  );

  function handleGenerate() {
    shareProject.mutate(
      {
        uid: session.user._id,
        pid: pid as string,
        token: session.token,
        permission,
      },
      {
        onSuccess: (data) => {
          setGeneratedLink(data.url);
          toast({
            title: "Link generated.",
            description: "Share this link with others.",
          });
        },
        onError: (error) => {
          toast({
            title: "Ups! An error occurred.",
            description: error.message,
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleCopy() {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied to clipboard",
      });
    }
  }

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (!newOpen) {
      setTimeout(() => {
        setGeneratedLink(null);
        setPermission("read");
        setCopied(false);
      }, 300);
    }
  }

  if (session.user.type === "anonymous") {
    return (
      <Button
        className="inline-flex"
        variant="outline"
        onClick={() => router.push("/login")}
      >
        <Share2 className="mr-2 size-4" /> Share Project
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="inline-flex" variant="outline">
          <Share2 className="mr-2 size-4" /> Share Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Share Project</DialogTitle>
          <DialogDescription>
            Generate a link to share this project with others.
          </DialogDescription>
        </DialogHeader>
        
        {!generatedLink ? (
          <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="permission" className="text-right">
              Permission
            </Label>
            <Select
              value={permission}
              onValueChange={(val: "read" | "write") => setPermission(val)}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select permission" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Can view</SelectItem>
                <SelectItem value="write">Can edit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          </div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="flex items-center space-x-2">
              <Input 
                readOnly 
                value={generatedLink} 
                className="flex-1"
              />
              <Button size="icon" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Anyone with this link can {permission === 'read' ? 'view' : 'edit'} the project.
            </p>
          </div>
        )}

        <DialogFooter>
          {!generatedLink ? (
            <Button
              onClick={handleGenerate}
              disabled={shareProject.isPending}
              className="inline-flex items-center gap-1"
            >
              <span>Generate Link</span>
              {shareProject.isPending && (
              <LoaderCircle className="size-[1em] animate-spin" />
            )}
          </Button>
          ) : (
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}