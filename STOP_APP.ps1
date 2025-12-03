# PowerShell script to stop the Torrent Video Streamer Frontend
# This script stops all Node.js processes running on port 3000

Write-Host "🛑 Stopping Torrent Video Streamer Frontend..." -ForegroundColor Yellow

# Function to stop processes on a specific port
function Stop-Port {
    param([int]$Port)
    
    $processes = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | 
                 Select-Object -ExpandProperty OwningProcess -Unique
    
    if ($processes) {
        foreach ($processId in $processes) {
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($process) {
                Write-Host "   Stopping process $processId ($($process.ProcessName)) on port $Port..." -ForegroundColor Gray
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            }
        }
        return $true
    }
    return $false
}

# Stop port 3000 (frontend)
Write-Host "🎨 Stopping frontend (port 3000)..." -ForegroundColor Cyan
$frontendStopped = Stop-Port -Port 3000
if ($frontendStopped) {
    Write-Host "   ✅ Frontend stopped" -ForegroundColor Green
} else {
    Write-Host "   ℹ️  No process found on port 3000" -ForegroundColor Gray
}

Write-Host ""
if ($frontendStopped) {
    Write-Host "✅ Frontend stopped successfully!" -ForegroundColor Green
} else {
    Write-Host "ℹ️  No running instances found" -ForegroundColor Gray
}
Write-Host ""

