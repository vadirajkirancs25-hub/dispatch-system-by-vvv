# Smart Delivery Dispatch System

## Team Information
- **Team Name**: [Bumbulbee]
- **Year**: [2026]
- **All-Female Team**: [no]

## Architecture Overview

#### Describe your approach here. Keep it short and clear.

    - What is your dispatch strategy?
    - How do you score agents for incoming orders?
    - How do you manage SLA deadlines, priority orders, and agent capacity?
    - What are the main steps in your pipeline?


**Note:** Please do not change the format or spelling of anything in this README. The fields are extracted using a script, so any changes to the structure or formatting may break the extraction process.



Our dispatch strategy is a score-based smart assignment system. For every incoming order, the software checks all available riders and chooses the rider with the lowest score, meaning the best overall match. The scoring function considers distance, estimated delivery time, SLA risk, rider workload, rating, and order priority. Distance is calculated using Manhattan distance on a grid, which represents city zones. ETA is calculated using order preparation time, rider travel distance, current rider workload, and dynamic traffic delay. 
Priority orders are handled using priority boosts. Urgent and high-priority orders reduce the score more, so they are assigned faster. SLA deadlines are managed by adding a penalty when ETA crosses the SLA limit. Rider capacity is controlled by allowing each rider to carry only up to 2 active orders. Fairness is handled using workload variance and fairness penalty, so one rider is not overloaded while others remain free.
The pipeline is: generate/load orders and riders, calculate ETA, filter eligible riders, compute score for each rider, select the best rider, assign the order, update rider workload, and finally mark orders as delivered. The dashboard also shows live map, rider status, order queue, activity feed, and score explanation for transparency.


