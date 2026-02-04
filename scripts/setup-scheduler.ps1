# CuriousMind Windows Task Scheduler Setup
# Run this script in PowerShell as Administrator

$taskName = "CuriousMind-ScheduledPush"
$scriptPath = "E:\Essai\src\jobs\scheduledPush.js"
$workingDir = "E:\Essai"

# Delete existing task if it exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create the action
$action = New-ScheduledTaskAction -Execute "node" -Argument $scriptPath -WorkingDirectory $workingDir

# Create trigger - runs every 2 days at 9:00 AM
$trigger = New-ScheduledTaskTrigger -Daily -DaysInterval 2 -At 9:00AM

# Create settings
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

# Register the task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "CuriousMind reading recommendations push"

Write-Host "✅ Scheduled task '$taskName' created successfully!"
Write-Host "   - Runs every 2 days at 9:00 AM"
Write-Host "   - Script: $scriptPath"
Write-Host ""
Write-Host "To run manually: schtasks /run /tn `"$taskName`""
Write-Host "To check status: Get-ScheduledTask -TaskName `"$taskName`""
