import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardList, Lock, Check, Coins, ExternalLink,
  MessageCircle, Share2, Users, TrendingUp, Shield, Crown, Star, Youtube,
  Timer, Megaphone
} from "lucide-react";
import { SiX, SiTelegram } from "react-icons/si";
import { formatNumber } from "@/lib/game-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TaskItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  taskType: string;
  rewardCoins: number;
  requiredTier: string | null;
  link: string | null;
  icon: string | null;
  completed: boolean;
  tierLocked: boolean;
}

const ICON_MAP: Record<string, React.ElementType> = {
  MessageCircle,
  Megaphone,
  Twitter: SiX,
  Youtube,
  Shield,
  Crown,
  Star,
  Share2,
  Users,
  Coins,
  TrendingUp,
};

const TELEGRAM_TASK_SLUGS = ["join-telegram", "join-lobby"];
const EXTERNAL_LINK_SLUGS = ["follow-x", "subscribe-youtube"];
const VISIT_COOLDOWN_SECONDS = 30;

function TaskCard({
  task,
  onClaim,
  isPending,
}: {
  task: TaskItem;
  onClaim: (id: string) => void;
  isPending: boolean;
}) {
  const Icon = ICON_MAP[task.icon || ""] || ClipboardList;
  const isTelegramTask = TELEGRAM_TASK_SLUGS.includes(task.slug);
  const isExternalTask = EXTERNAL_LINK_SLUGS.includes(task.slug);

  const [visited, setVisited] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleVisitLink = useCallback(() => {
    if (task.link) {
      window.open(task.link, "_blank");
      setVisited(true);
      setCountdown(VISIT_COOLDOWN_SECONDS);
    }
  }, [task.link]);

  const canClaim = () => {
    if (task.completed || task.tierLocked) return false;
    if (isTelegramTask) return true;
    if (isExternalTask) return visited && countdown === 0;
    return true;
  };

  const renderActions = () => {
    if (task.completed) {
      return (
        <Badge variant="secondary" data-testid={`badge-task-done-${task.slug}`}>
          <Check className="h-3 w-3 mr-1" />
          Done
        </Badge>
      );
    }

    if (task.tierLocked) {
      return (
        <Button size="sm" variant="outline" disabled data-testid={`button-task-locked-${task.slug}`}>
          <Lock className="h-3 w-3 mr-1" />
          Locked
        </Button>
      );
    }

    if (isTelegramTask) {
      return (
        <div className="flex items-center gap-1.5">
          {task.link && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.open(task.link!, "_blank")}
              data-testid={`button-task-link-${task.slug}`}
            >
              <SiTelegram className="h-3.5 w-3.5 mr-1" />
              Join
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onClaim(task.id)}
            disabled={isPending}
            data-testid={`button-task-claim-${task.slug}`}
          >
            Verify
          </Button>
        </div>
      );
    }

    if (isExternalTask) {
      return (
        <div className="flex items-center gap-1.5">
          {!visited ? (
            <Button
              size="sm"
              onClick={handleVisitLink}
              data-testid={`button-task-visit-${task.slug}`}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Visit
            </Button>
          ) : countdown > 0 ? (
            <Button size="sm" variant="outline" disabled data-testid={`button-task-timer-${task.slug}`}>
              <Timer className="h-3.5 w-3.5 mr-1" />
              {countdown}s
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onClaim(task.id)}
              disabled={isPending}
              data-testid={`button-task-claim-${task.slug}`}
            >
              Claim
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        {task.link && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => window.open(task.link!, "_blank")}
            data-testid={`button-task-link-${task.slug}`}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => onClaim(task.id)}
          disabled={isPending}
          data-testid={`button-task-claim-${task.slug}`}
        >
          Claim
        </Button>
      </div>
    );
  };

  return (
    <Card data-testid={`card-task-${task.slug}`}>
      <CardContent className="p-4 flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium" data-testid={`text-task-title-${task.slug}`}>{task.title}</p>
            {task.requiredTier && (
              <Badge variant="outline" className="text-xs">
                {task.requiredTier}+
              </Badge>
            )}
            {isTelegramTask && !task.completed && (
              <Badge variant="outline" className="text-xs">
                Verified
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
          <div className="flex items-center gap-1 mt-1">
            <Coins className="h-3 w-3 text-primary" />
            <span className="text-xs font-medium text-primary">+{formatNumber(task.rewardCoins)}</span>
          </div>
        </div>
        <div className="shrink-0">
          {renderActions()}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Tasks() {
  const { toast } = useToast();

  const { data: tasks, isLoading, error } = useQuery<TaskItem[]>({
    queryKey: ["/api/tasks"],
  });

  const claimMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiRequest("POST", `/api/tasks/${taskId}/claim`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Task Completed!",
        description: `+${formatNumber(data.coinsAwarded)} coins earned`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: (error: Error) => {
      let description = error.message;
      try {
        const jsonPart = error.message.replace(/^\d+:\s*/, "");
        const parsed = JSON.parse(jsonPart);
        if (parsed.message) description = parsed.message;
      } catch {}
      toast({
        title: "Cannot claim",
        description,
        variant: "destructive",
      });
    },
  });

  const socialTasks = tasks?.filter(t => t.category === "social") || [];
  const proTasks = tasks?.filter(t => t.category === "pro") || [];
  const dailyTasks = tasks?.filter(t => t.category === "daily") || [];

  const completedCount = tasks?.filter(t => t.completed).length || 0;
  const totalCount = tasks?.length || 0;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-lg mx-auto">
        <Skeleton className="h-8 w-48 mx-auto" />
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-sm text-destructive font-medium">Failed to load tasks</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-tasks-title">Tasks</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Complete tasks to earn coins. {completedCount}/{totalCount} done today.
        </p>
      </div>

      <Tabs defaultValue="social" className="w-full">
        <TabsList className="w-full grid grid-cols-3" data-testid="tabs-tasks">
          <TabsTrigger value="social" data-testid="tab-social">Social</TabsTrigger>
          <TabsTrigger value="pro" data-testid="tab-pro">Pro</TabsTrigger>
          <TabsTrigger value="daily" data-testid="tab-daily">Daily</TabsTrigger>
        </TabsList>

        <TabsContent value="social" className="mt-4 space-y-2">
          {socialTasks.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No social tasks available.</CardContent></Card>
          ) : socialTasks.map(task => (
            <TaskCard key={task.id} task={task} onClaim={(id) => claimMutation.mutate(id)} isPending={claimMutation.isPending} />
          ))}
        </TabsContent>

        <TabsContent value="pro" className="mt-4 space-y-2">
          {proTasks.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No pro tasks available.</CardContent></Card>
          ) : proTasks.map(task => (
            <TaskCard key={task.id} task={task} onClaim={(id) => claimMutation.mutate(id)} isPending={claimMutation.isPending} />
          ))}
        </TabsContent>

        <TabsContent value="daily" className="mt-4 space-y-2">
          {dailyTasks.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No daily tasks available.</CardContent></Card>
          ) : dailyTasks.map(task => (
            <TaskCard key={task.id} task={task} onClaim={(id) => claimMutation.mutate(id)} isPending={claimMutation.isPending} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
