# 注册 Windows 计划任务：每 30 分钟自动抓取一次赛程
# 用法：右键「使用 PowerShell 运行」，或在 PowerShell 里执行 .\install-task.ps1
# 卸载：Unregister-ScheduledTask -TaskName "EsportsScheduleRefresh" -Confirm:$false

$ErrorActionPreference = 'Stop'

$node = (Get-Command node -ErrorAction Stop).Source
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path

$action  = New-ScheduledTaskAction -Execute $node `
             -Argument "scripts/fetch.mjs" `
             -WorkingDirectory $dir

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
             -RepetitionInterval (New-TimeSpan -Minutes 30) `
             -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
             -StartWhenAvailable `
             -DontStopIfGoingOnBatteries `
             -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName "EsportsScheduleRefresh" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "每 30 分钟抓取一次电竞赛事赛程" -Force | Out-Null

Write-Host "已注册：EsportsScheduleRefresh（每 30 分钟）" -ForegroundColor Green
Write-Host "手动跑一次测效果：$node $dir\scripts\fetch.mjs"
