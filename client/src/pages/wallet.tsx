import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Copy, Check, Clock, CheckCircle, XCircle, ArrowDownLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { formatUSD } from "@/lib/game-utils";
import { useToast } from "@/hooks/use-toast";
import type { Deposit } from "@shared/schema";

type Network = "ton" | "trc20";

const NETWORKS: { id: Network; label: string; name: string; color: string }[] = [
  { id: "ton", label: "TON", name: "USDT on TON", color: "bg-sky-500/10 text-sky-500" },
  { id: "trc20", label: "TRC-20", name: "USDT on Tron", color: "bg-red-500/10 text-red-500" },
];

function statusIcon(status: string) {
  switch (status) {
    case "confirmed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return <Clock className="h-4 w-4 text-amber-500" />;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":
      return <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400 border-0">Confirmed</Badge>;
    case "failed":
      return <Badge variant="secondary" className="bg-red-500/10 text-red-600 dark:text-red-400 border-0">Failed</Badge>;
    default:
      return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0">Pending</Badge>;
  }
}

export default function WalletPage() {
  const [selectedNetwork, setSelectedNetwork] = useState<Network>("ton");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const { data: wallet, isLoading: walletLoading } = useQuery<{
    balance: number;
    addresses: Record<string, string>;
  }>({
    queryKey: ["/api/wallet"],
  });

  const { data: deposits, isLoading: depositsLoading } = useQuery<Deposit[]>({
    queryKey: ["/api/deposits"],
  });

  const address = wallet?.addresses?.[selectedNetwork] || "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast({ title: "Address copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  if (walletLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-wallet-title">
          Wallet
        </h1>
        <p className="text-muted-foreground text-sm">
          Deposit USDT to load your in-game credits
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">USDT Balance</p>
              <p className="text-3xl font-bold tracking-tight" data-testid="text-wallet-balance">
                {formatUSD(wallet?.balance || 0)}
              </p>
            </div>
            <div className="p-3 rounded-md bg-primary/10 text-primary">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ArrowDownLeft className="h-5 w-5" />
          Deposit USDT
        </h2>

        <div className="flex gap-2" data-testid="network-selector">
          {NETWORKS.map((net) => (
            <Button
              key={net.id}
              variant={selectedNetwork === net.id ? "default" : "outline"}
              size="sm"
              onClick={() => { setSelectedNetwork(net.id); setCopied(false); }}
              data-testid={`button-network-${net.id}`}
            >
              {net.label}
            </Button>
          ))}
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="text-center space-y-1">
              <Badge variant="secondary" className={NETWORKS.find(n => n.id === selectedNetwork)?.color}>
                {NETWORKS.find(n => n.id === selectedNetwork)?.name}
              </Badge>
            </div>

            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-md">
                <QRCodeSVG
                  value={address}
                  size={180}
                  level="M"
                  data-testid="qr-code"
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Send only USDT on the {NETWORKS.find(n => n.id === selectedNetwork)?.name} network
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all font-mono"
                  data-testid="text-deposit-address"
                >
                  {address}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopy}
                  data-testid="button-copy-address"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Deposits are automatically detected once confirmed on the blockchain. Credits will be added to your balance within minutes.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Deposit History</h2>
        {depositsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : !deposits || deposits.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No deposits yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Send USDT to the address above to get started
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2" data-testid="deposit-history">
            {deposits.map((dep) => (
              <Card key={dep.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3">
                      {statusIcon(dep.status)}
                      <div>
                        <p className="text-sm font-medium">{formatUSD(dep.amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {dep.network.toUpperCase()} · {new Date(dep.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {statusBadge(dep.status)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
