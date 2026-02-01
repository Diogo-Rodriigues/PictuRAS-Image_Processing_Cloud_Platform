import { LoaderCircle, Sparkle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { useEffect, useState } from "react";
import {
  useCurrentImage,
  usePreview,
  useProjectInfo,
} from "@/providers/project-provider";
import {
  useAddProjectTool,
  useDeleteProjectTool,
  usePreviewProjectResult,
  useUpdateProjectTool,
  useReorderProjectTools,
} from "@/lib/mutations/projects";
import { ProjectTool, ProjectToolResponse } from "@/lib/projects";
import { toast } from "@/hooks/use-toast";
import { useGetSocket } from "@/lib/queries/projects";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface ToolbarButtonProps {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  isDefault?: boolean;
  isPremium?: boolean;
  tool: Omit<ProjectTool, "position">;
  children?: React.ReactNode;
  noParams?: boolean;
  onDefault?: () => void;
}

interface ConflictEntries {
  positions: { id: string, position: number }[],
  events: EventEmitter,
  lastChecked: string[]
}

declare global {
  interface Window {
    __fodase2_conflicts: ConflictEntries;
  }
}

//#region ============== START OF THE SHAMELESS FUCKERY ==============
const E_SHITCHANGED = "shitchanged";

// All this pile of shit is here because React is the absolute worst piece of software that has ever had the disonor of 
// dessecrating these foul, forsaken saken lands, and I absolutely fucking CANNOT dedicate any more of my lifetime to 
// deal with its absolutely rancid API and quirks at 6 AM. Fuck React and everything it stands for, and curse everyone 
// that has ever contributed to its proliferation.
type Subscriber = (...args: any[]) => void;
class EventEmitter {
  subscribers: Record<string, Subscriber[]>;
  constructor() {
    this.subscribers = {};
  }

  on(event: string, callback: Subscriber) {
    this.subscribers[event] ??= [];

    if (!this.subscribers[event].find(c => c === callback)) this.subscribers[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: Subscriber) {
    this.subscribers[event]?.splice(this.subscribers[event]?.findIndex(c => c === callback), 1);
  }

  emit(event: string, ...args: unknown[]) {
    if (event in this.subscribers) {
      for (const sub of this.subscribers[event]) sub(...args);
    }
  }
}

function _assertConflictEntries() {
  window.__fodase2_conflicts ??= {
    positions: [],
    events: new EventEmitter(),
    lastChecked: []
  };
}

function getPositionEntry(toolId: string) {
  return window.__fodase2_conflicts.positions.find(p => p.id === toolId);
}

function setPositionEntry(toolId: string, pos: number) {
  _assertConflictEntries();
  const entry = window.__fodase2_conflicts.positions.find(p => p.id === toolId);
  if (entry) {
    entry.position = pos;
  } else {
    window.__fodase2_conflicts.positions.push({ id: toolId, position: pos });
  }
}

function killPositionEntry(toolId: string) {
  _assertConflictEntries();
  window.__fodase2_conflicts.positions.splice(window.__fodase2_conflicts.positions.findIndex(p => p.id === toolId), 1);
}

function hasConflict(pos: number, ownId: string) {
  _assertConflictEntries();
  const conflicts = window.__fodase2_conflicts.positions.filter(c => c.position === pos);
  ownId==="695d9b26100d685df8097fc8"&&console.log("CONFUCKINGFLICT:", conflicts, conflicts.findIndex(c => c.id === ownId))
  if (!conflicts.find(c => c.id === ownId)) return false;

  window.__fodase2_conflicts.lastChecked = conflicts.map(c => c.id);
  return conflicts.length > 1;
}

function getFodase2Events() {
  return window.__fodase2_conflicts.events;
}

function fodase2EventShitChanged(ownId: string) {
  console.log("YEETING SHITCHANGED TO:", window.__fodase2_conflicts.events.subscribers[E_SHITCHANGED], window.__fodase2_conflicts.lastChecked.filter(i => i !== ownId))
  window.__fodase2_conflicts.events.emit(E_SHITCHANGED, window.__fodase2_conflicts.lastChecked.filter(i => i !== ownId));
}
//#region ============== END OF THE SHAMELESS FUCKERY ==============
// Beyond this point, we're back to the regular pile of steaming shit that is react.

export function ToolbarButton({
  open = false,
  setOpen = () => {},
  icon: Icon,
  label,
  disabled = false,
  isDefault = false,
  isPremium = false,
  tool,
  children,
  noParams = false,
  onDefault = () => {},
}: ToolbarButtonProps) {
  const router = useRouter();
  const session = useSession();
  const project = useProjectInfo();
  const preview = usePreview();
  const variant =
    project.tools.find((t) => t.procedure === tool.procedure) !== undefined
      ? "default"
      : "outline";
  const socket = useGetSocket(session.token);

  const currentImage = useCurrentImage();
  const addTool = useAddProjectTool(
    project.user_id,
    project._id,
    session.token,
    project.shareToken,
  );
  const updateTool = useUpdateProjectTool(
    project.user_id,
    project._id,
    session.token,
    project.shareToken,
  );
  const deleteTool = useDeleteProjectTool(
    project.user_id,
    project._id,
    session.token,
    project.shareToken,
  );
  const previewEdits = usePreviewProjectResult();
  const reorderTools = useReorderProjectTools(project.user_id, project._id, session.token, project.shareToken);

  const [prevTool, setPrevTool] = useState<ProjectToolResponse | undefined>(
    undefined,
  );
  const [waiting, setWaiting] = useState<boolean>(false);
  const [timedout, setTimedout] = useState<boolean>(false);
  const [position, setPosition] = useState<number>(prevTool?.position ?? project.tools.length);
  const [positionConflict, setPositionConflict] = useState<boolean>(false);

  //#region -------------- FUCKING VARIABLES --------------
  let _prevToolId = "";
  let _prevToolPos = 0;
  let _positionConflict = false;
  //#endregion -------------- FUCKING VARIABLES --------------
  
  // console.log("FUCKING TOOL:", prevTool, positionConflict);

  function handleDeleteTool() {
    if (prevTool) {
      const id = prevTool._id;
      deleteTool.mutate(
        {
          uid: project.user_id,
          pid: project._id,
          toolId: prevTool._id,
          token: session.token,
          requesterId: session.user._id,
        },
        {
          onError: (error) => {
            toast({
              title: "Ups! An error occurred.",
              description: error.message,
              variant: "destructive",
            });
          },
          onSuccess: () => {
            killPositionEntry(id);
          }
        },
      );
    }
  }

  function handlePreview() {
    previewEdits.mutate(
      {
        uid: project.user_id,
        pid: project._id,
        imageId: currentImage?._id ?? "",
        token: session.token,
        requesterId: session.user._id,
        shareToken: project.shareToken,
      },
      {
        onSuccess: () => {
          setWaiting(true);
          preview.setWaiting(tool.procedure);
          setTimeout(
            () => setTimedout(true),
            10000 * (project.tools.length + 1),
          );
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

  function handleAddTool(preview?: boolean) {
    const hasConflict = checkConflict(position);

    if (prevTool) {
      const updateObj: Record<string, unknown> = {
        uid: project.user_id,
        pid: project._id,
        toolId: prevTool._id,
        toolParams: tool.params,
        token: session.token,
        requesterId: session.user._id,
      };

      const actualTool = project.tools.find(t => t._id === prevTool._id);
      console.log("FUCKING UPDATE:", !hasConflict, !!actualTool, prevTool.position, actualTool!.position, !hasConflict && actualTool && prevTool.position !== actualTool.position, updateObj);
    //   if (!hasConflict && actualTool && prevTool.position !== actualTool.position) {
    //     updateObj.position = prevTool.position;
    //   }


      updateTool.mutate(
        updateObj,
        {
          onSuccess: () => {
            if (preview) handlePreview();
            
            console.log("TOOLS:", project.tools);
            const orders = project.tools.map(t => {
                const stored = getPositionEntry(t._id)?.position;
                if (t && stored && t.position !== stored) return { i: stored, ...t };
                return { i: t.position, ...t };
            }).sort((a, b) => a.i - b.i).map((t, idx) => ({ ...t, position: idx }));
            console.log("NEW ORDERS:", orders);

            reorderTools.mutate({ orders });
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
    } else {
      addTool.mutate(
        {
          uid: project.user_id,
          pid: project._id,
          tool: {
            ...tool,
            position: project.tools.length,
          },
          token: session.token,
          requesterId: session.user._id,
        },
        {
          onSuccess: () => {
            if (preview) handlePreview();
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
    setOpen(false);
  }

  function handleClick() {
    if (isPremium) {
      if (session.user.type === "anonymous") {
        router.push("/login");
        return;
      }
      if (noParams) {
        if (prevTool) handleDeleteTool();
        else handleAddTool(true);
      }
      return;
    }
    if (noParams) {
      if (prevTool) handleDeleteTool();
      else handleAddTool(true);
    }
  }

  function checkConflict(pos: number) {
    if (pos === -1) return;
    
    console.log(
      "HAS FUCKING CONFLICT:", [prevTool?._id, _prevToolId, (_prevToolId || prevTool?._id) ?? ""], pos, 
      JSON.stringify(window.__fodase2_conflicts.positions, null, 4), 
      hasConflict(pos, (_prevToolId || prevTool?._id) ?? "")
    )

    if (hasConflict(pos, (_prevToolId || prevTool?._id) ?? "")) {
      setPositionConflict(true);
      _positionConflict = true;
      return true;
    } else {
      setPositionConflict(false);
      _positionConflict = false;
      return false;
    }
  }

  function handlePosition(pos: number) {
    if (pos < 0) return;

    setPosition(pos);
    setPositionEntry(prevTool!._id, pos);
    checkConflict(pos);
    fodase2EventShitChanged(prevTool!._id);
    if (!_positionConflict) {
      setPrevTool((prev) => (prev ? { ...prev, position: pos } : prev));
    }
  }

  useEffect(() => {
    if (timedout) {
      if (waiting) {
        setWaiting(false);
        preview.setWaiting("");
        toast({
          title: "Ups! An error occurred.",
          description: "The preview took too long to load.",
          variant: "destructive",
        });
      }
      setTimedout(false);
    }
  }, [timedout, waiting, preview]);

  useEffect(() => {
    let active = true;

    if (active && socket.data) {
      socket.data.on("preview-ready", () => {
        if (active) {
          setWaiting(false);
          preview.setWaiting("");
        }
      });
    }

    return () => {
      active = false;
      if (socket.data) {
        socket.data.off("preview-ready");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket.data]);

  useEffect(() => {
    const prevTool = project.tools.find((t) => t.procedure === tool.procedure);
    setPrevTool(prevTool);
    _prevToolId = prevTool?._id ?? "";
    
    if (prevTool) {
      const pos = prevTool?.position ?? -1;
      console.log("FUCK THIS BITCH", prevTool._id);
      setPosition(pos);
      setPositionEntry(prevTool?._id ?? "FUDEU", pos);
      checkConflict(pos);
    } else {
      console.log("HAS FUCK ALL");
      setPosition(project.tools.length);
    }
  }, [project.tools, tool.procedure]);

  useEffect(() => {
    _assertConflictEntries();
    getFodase2Events().on(E_SHITCHANGED, (conflicts: string[]) => {
      if (_prevToolId) console.log(
        "SHIT CHANGED BRO", 
        _prevToolId, conflicts, 
        conflicts.includes(_prevToolId),
        position, positionConflict, _positionConflict
      );
      if (conflicts.includes(_prevToolId) || positionConflict || _positionConflict) {
        checkConflict(getPositionEntry(_prevToolId)?.position ?? project.tools.length);
      }
    });
  }, []);

  const TButton = () => (
    <Tooltip>
      <Button
        variant={variant}
        className={`size-8 relative ${isPremium && variant === "default" && "bg-indigo-500 hover:bg-indigo-400"} ${positionConflict ? "bg-red-900 hover:bg-red-900" : ""}`}
        disabled={
          disabled ||
          (preview.waiting !== tool.procedure && preview.waiting !== "")
        }
        onClick={handleClick}
      >
        {waiting ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <>
            {isPremium ? (
              <TooltipTrigger asChild>
                <div
                  className={
                    isPremium && variant === "default"
                      ? "text-white"
                      : "text-indigo-500"
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  <Sparkle className="h-3 w-3 absolute -top-1 -right-1" />
                  <span className="sr-only">{label}</span>
                </div>
              </TooltipTrigger>
            ) : (
              <>
                <Icon className="h-3.5 w-3.5" />
                <span className="sr-only">{label}</span>
              </>
            )}
          </>
        )}
      </Button>
      <TooltipContent className="ml-2 bg-indigo-500" side="right">
        {label}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {!((isPremium && session.user.type === "anonymous") || noParams) ? (
        <DropdownMenuTrigger
          asChild
          disabled={
            disabled ||
            (preview.waiting !== tool.procedure && preview.waiting !== "")
          }
        >
          <div>
            <TButton />
          </div>
        </DropdownMenuTrigger>
      ) : (
        <div>
          <TButton />
        </div>
      )}
      <DropdownMenuContent
        className="w-[--radix-dropdown-menu-trigger-width] min-w-64 rounded-lg"
        side="right"
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-sm p-1">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="p-1">{children}</div>
        <DropdownMenuSeparator />
        <div className="p-1">
          <div className="space-y-1">
            <div className="flex w-full justify-between items-center text-sm text-gray-500">
              <Label htmlFor="position">Position</Label>
              <div className="flex items-center space-x-2 w-1/2">
                <Input
                  id="position"
                  type="number"
                  value={position}
                  onChange={(e) => handlePosition(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <div className="flex w-full gap-1 items-center">
          <Button
            variant={"outline"}
            className="h-6 text-xs"
            onClick={() => {
              handleDeleteTool();
              onDefault();
            }}
            disabled={isDefault}
          >
            Default
          </Button>
          <Button
            variant="outline"
            onClick={() => handleAddTool(true)}
            className="h-6 text-xs"
            disabled={isDefault}
          >
            Preview
          </Button>
          <Button
            onClick={() => handleAddTool()}
            disabled={isDefault}
            className={`h-6 text-xs w-full ${positionConflict ? "bg-red-50 text-red-700 hover:bg-red-50" : ""}`}
          >
            Save
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
